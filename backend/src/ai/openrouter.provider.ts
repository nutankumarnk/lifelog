/**
 * OpenRouter adapter.
 *
 * OpenRouter is a routing gateway in front of many model hosts, which is why
 * Lifelog uses it: changing model is a string change, not a code change.
 * See docs/decision.md ("Why an AI provider abstraction?").
 *
 * This file contains no Lifelog business rules. It moves a prompt out and a
 * JSON object back, and turns every failure mode into an `AiProviderError`.
 */
import { AiProviderError, type AiProvider, type AnalysisRequest, type ProviderResult } from './provider.js';
import { parseModelJson } from './json.js';

export interface OpenRouterOptions {
  apiKey: string | undefined;
  model: string;
  baseUrl: string;
  timeoutMs: number;
  temperature: number;
  appUrl?: string;
  appTitle?: string;
  /** Injected in tests. Defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string | null } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string; code?: string | number };
}

export class OpenRouterProvider implements AiProvider {
  readonly name = 'openrouter';
  readonly model: string;

  private readonly options: OpenRouterOptions;
  private readonly fetchImpl: typeof fetch;

  constructor(options: OpenRouterOptions) {
    this.options = options;
    this.model = options.model;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
  }

  isAvailable(): boolean {
    return Boolean(this.options.apiKey);
  }

  async analyze(request: AnalysisRequest): Promise<ProviderResult> {
    if (!this.options.apiKey) {
      throw new AiProviderError('UNAVAILABLE', this.name, 'no OpenRouter API key configured', {
        retryable: false,
      });
    }

    const startedAt = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.options.baseUrl}/chat/completions`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.options.apiKey}`,
          // Optional OpenRouter attribution headers. Non-secret.
          ...(this.options.appUrl ? { 'HTTP-Referer': this.options.appUrl } : {}),
          ...(this.options.appTitle ? { 'X-Title': this.options.appTitle } : {}),
        },
        body: JSON.stringify({
          model: this.options.model,
          temperature: this.options.temperature,
          // Ask for JSON. Not every routed model honours this, which is exactly
          // why `parseModelJson` and the validation layer still exist.
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: request.instructions },
            { role: 'user', content: request.userMessage },
          ],
        }),
      });
    } catch (error) {
      const aborted = error instanceof Error && error.name === 'AbortError';
      throw new AiProviderError(
        aborted ? 'TIMEOUT' : 'NETWORK',
        this.name,
        aborted ? `model call exceeded ${this.options.timeoutMs}ms` : 'network failure calling model host',
        { cause: error },
      );
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      throw this.toHttpError(response.status, await this.safeText(response));
    }

    let payload: ChatCompletionResponse;
    try {
      payload = (await response.json()) as ChatCompletionResponse;
    } catch (error) {
      throw new AiProviderError('BAD_OUTPUT', this.name, 'model host returned non-JSON body', {
        retryable: true,
        cause: error,
      });
    }

    if (payload.error) {
      throw new AiProviderError('UPSTREAM', this.name, payload.error.message ?? 'model host error', {
        retryable: true,
      });
    }

    const content = payload.choices?.[0]?.message?.content ?? '';
    const parsed = parseModelJson(content);
    if (!parsed.ok) {
      throw new AiProviderError('BAD_OUTPUT', this.name, `model did not return JSON: ${parsed.error}`, {
        retryable: true,
      });
    }

    return {
      raw: parsed.value,
      rawText: content,
      latencyMs: Date.now() - startedAt,
      usage: {
        promptTokens: payload.usage?.prompt_tokens,
        completionTokens: payload.usage?.completion_tokens,
      },
    };
  }

  private toHttpError(status: number, body: string): AiProviderError {
    // Truncated so an upstream error can never dump a whole conversation into logs.
    const detail = body.slice(0, 200);
    if (status === 401 || status === 403) {
      return new AiProviderError('AUTH', this.name, 'model host rejected the API key', {
        retryable: false,
      });
    }
    if (status === 429) {
      return new AiProviderError('RATE_LIMITED', this.name, 'model host rate limit reached');
    }
    if (status >= 500) {
      return new AiProviderError('UPSTREAM', this.name, `model host error ${status}`, {
        retryable: true,
      });
    }
    return new AiProviderError('UPSTREAM', this.name, `model host error ${status}: ${detail}`, {
      retryable: false,
    });
  }

  private async safeText(response: Response): Promise<string> {
    try {
      return await response.text();
    } catch {
      return '';
    }
  }
}
