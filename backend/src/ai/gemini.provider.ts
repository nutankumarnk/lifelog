/**
 * Direct Google Gemini adapter.
 *
 * This module translates Lifelog's provider request to Gemini's REST
 * generateContent shape and returns loose JSON. Product rules stay in the
 * intelligence pipeline, exactly as they do for every other provider.
 */
import { parseModelJson } from './json.js';
import {
  AiProviderError,
  type AiProvider,
  type AnalysisRequest,
  type ProviderResult,
} from './provider.js';
import { estimateUsage, reportedUsage } from './usage.js';

const MAX_OUTPUT_TOKENS = 2048;

export interface GeminiOptions {
  apiKey: string | undefined;
  model: string;
  baseUrl: string;
  timeoutMs: number;
  temperature: number;
  /** Injected in tests. Defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    finishReason?: string;
  }>;
  promptFeedback?: { blockReason?: string };
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
  error?: { code?: number; message?: string; status?: string };
}

function hardTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new AiProviderError('TIMEOUT', 'gemini', `model call exceeded ${ms}ms`, { retryable: false })),
      ms,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export class GeminiProvider implements AiProvider {
  readonly name = 'gemini';
  readonly model: string;

  private readonly options: GeminiOptions;
  private readonly fetchImpl: typeof fetch;

  constructor(options: GeminiOptions) {
    this.options = options;
    this.model = options.model;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
  }

  isAvailable(): boolean {
    return Boolean(this.options.apiKey);
  }

  async analyze(request: AnalysisRequest): Promise<ProviderResult> {
    const apiKey = this.options.apiKey;
    if (!apiKey) {
      throw new AiProviderError('UNAVAILABLE', this.name, 'no Gemini API key configured', {
        retryable: false,
      });
    }

    return await hardTimeout(this.callModel(request, apiKey), this.options.timeoutMs);
  }

  private async callModel(request: AnalysisRequest, apiKey: string): Promise<ProviderResult> {
    const startedAt = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);

    try {
      const model = this.options.model.replace(/^models\//, '');
      const requestBody = {
        systemInstruction: { parts: [{ text: request.instructions }] },
        contents: [
          {
            role: 'user',
            parts: [{ text: request.userMessage }],
          },
        ],
        generationConfig: {
          temperature: this.options.temperature,
          maxOutputTokens: MAX_OUTPUT_TOKENS,
          responseMimeType: 'application/json',
        },
      };
      const response = await this.fetchImpl(
        `${this.options.baseUrl}/models/${encodeURIComponent(model)}:generateContent`,
        {
          method: 'POST',
          signal: controller.signal,
          headers: {
            'Content-Type': 'application/json',
            'X-goog-api-key': apiKey,
          },
          body: JSON.stringify(requestBody),
        },
      );

      if (!response.ok) {
        throw this.toHttpError(response.status);
      }

      const payload = await this.readPayload(response);
      const content = payload.candidates?.[0]?.content?.parts
        ?.map((part) => part.text ?? '')
        .join('')
        .trim() ?? '';
      const parsed = parseModelJson(content);

      if (!parsed.ok) {
        const blocked = payload.promptFeedback?.blockReason;
        throw new AiProviderError(
          'BAD_OUTPUT',
          this.name,
          blocked ? 'model blocked the request' : `model did not return JSON: ${parsed.error}`,
          { retryable: false },
        );
      }

      const usage = reportedUsage(
        payload.usageMetadata?.promptTokenCount,
        payload.usageMetadata?.candidatesTokenCount,
        payload.usageMetadata?.totalTokenCount,
      );

      return {
        raw: parsed.value,
        rawText: content,
        latencyMs: Date.now() - startedAt,
        usage: usage ?? estimateUsage(`${request.instructions}\n${request.userMessage}`, content),
        exchange: { request: requestBody, response: payload },
      };
    } catch (error) {
      if (error instanceof AiProviderError) throw error;
      const aborted = error instanceof Error && error.name === 'AbortError';
      throw new AiProviderError(
        aborted ? 'TIMEOUT' : 'NETWORK',
        this.name,
        aborted ? `model call exceeded ${this.options.timeoutMs}ms` : 'network failure calling Gemini',
        { cause: error, retryable: !aborted },
      );
    } finally {
      clearTimeout(timer);
    }
  }

  private async readPayload(response: Response): Promise<GeminiResponse> {
    try {
      const payload = (await response.json()) as GeminiResponse;
      if (payload.error) {
        throw new AiProviderError('UPSTREAM', this.name, 'Gemini returned an error payload', {
          retryable: true,
        });
      }
      return payload;
    } catch (error) {
      if (error instanceof AiProviderError) throw error;
      throw new AiProviderError('BAD_OUTPUT', this.name, 'Gemini returned a non-JSON body', {
        retryable: false,
        cause: error,
      });
    }
  }

  private toHttpError(status: number): AiProviderError {
    if (status === 401 || status === 403) {
      return new AiProviderError('AUTH', this.name, 'Gemini rejected the API key', { retryable: false });
    }
    if (status === 429) {
      return new AiProviderError('RATE_LIMITED', this.name, 'Gemini rate limit reached', {
        retryable: false,
      });
    }
    if (status === 408 || status === 504) {
      return new AiProviderError('TIMEOUT', this.name, `Gemini returned error ${status}`, {
        retryable: false,
      });
    }
    if (status >= 500) {
      return new AiProviderError('UPSTREAM', this.name, `Gemini returned error ${status}`, {
        retryable: true,
      });
    }
    return new AiProviderError('UPSTREAM', this.name, `Gemini returned error ${status}`, {
      retryable: false,
    });
  }
}
