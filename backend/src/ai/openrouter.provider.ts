/**
 * OpenRouter adapter.
 *
 * OpenRouter is a routing gateway in front of many model hosts, which is why
 * Lifelog uses it: changing model is a string change, not a code change.
 * See docs/decision.md ("Why an AI provider abstraction?").
 *
 * This file contains no Lifelog business rules. It moves a prompt out and a
 * JSON object back, and turns every failure mode into an `AiProviderError`.
 *
 * Latency / completeness notes:
 *   - Gemma 4 thinks by default. Thinking tokens count against `max_tokens`,
 *     so a 600-token cap often returns an empty `content` field. Lifelog then
 *     looked like it "failed to send a response." Reasoning is turned off,
 *     and enough completion tokens are reserved for the JSON.
 *   - `content` may be a string or an array of parts. Both are read.
 *   - Empty or unparseable bodies are retried once inside the same deadline.
 *   - Timeouts and rate limits are not retried. The registry falls back to
 *     the offline engine instead of waiting on a saturated free queue.
 */
import { AiProviderError, type AiProvider, type AnalysisRequest, type ProviderResult } from './provider.js';
import { extractChatText, parseModelJson } from './json.js';

/** Enough for a compact multi-item analysis JSON, with headroom if a host still thinks. */
const MAX_COMPLETION_TOKENS = 2048;

/**
 * Resolves with `promise`, or rejects with `makeError()` when `ms` elapses.
 * AbortSignal alone is not enough — some upstreams accept the socket and then
 * stall without ever delivering a body, and Node's fetch does not always
 * reject promptly in that state.
 */
function raceTimeout<T>(promise: Promise<T>, ms: number, makeError: () => Error): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(makeError()), ms);
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
  choices?: Array<{
    finish_reason?: string | null;
    text?: string | null;
    message?: {
      content?: unknown;
      reasoning?: unknown;
      reasoning_content?: unknown;
    };
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string; code?: string | number };
  model?: string;
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

    const deadline = Date.now() + this.options.timeoutMs;

    // Free-tier hosts sometimes accept the TCP connection and then stall past
    // AbortSignal. Race a hard deadline so Lifelog can fall back instead of
    // leaving the HTTP request open for minutes.
    return await raceTimeout(
      this.callModel(request, deadline),
      this.options.timeoutMs,
      () =>
        new AiProviderError(
          'TIMEOUT',
          this.name,
          `model call exceeded ${this.options.timeoutMs}ms`,
          { retryable: false },
        ),
    );
  }

  private async callModel(request: AnalysisRequest, deadline: number): Promise<ProviderResult> {
    const startedAt = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(1, deadline - Date.now()));

    try {
      let disableReasoning = true;
      let response = await this.postChat(request, controller, disableReasoning);

      // Some hosts reject the unified reasoning parameter. Retry without it
      // rather than failing the whole conversation.
      if (response.status === 400 && disableReasoning) {
        disableReasoning = false;
        response = await this.postChat(request, controller, disableReasoning);
      }

      if (!response.ok) {
        throw this.toHttpError(response.status, await this.safeText(response));
      }

      let payload = await this.readPayload(response);
      let content = extractChatText(payload);
      let parsed = parseModelJson(content);

      if (!parsed.ok && Date.now() < deadline - 250) {
        response = await this.postChat(request, controller, disableReasoning);
        if (!response.ok) {
          throw this.toHttpError(response.status, await this.safeText(response));
        }
        payload = await this.readPayload(response);
        content = extractChatText(payload);
        parsed = parseModelJson(content);
      }

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
    } catch (error) {
      if (error instanceof AiProviderError) throw error;
      const aborted = error instanceof Error && error.name === 'AbortError';
      throw new AiProviderError(
        aborted ? 'TIMEOUT' : 'NETWORK',
        this.name,
        aborted ? `model call exceeded ${this.options.timeoutMs}ms` : 'network failure calling model host',
        { cause: error, retryable: aborted ? false : true },
      );
    } finally {
      clearTimeout(timer);
    }
  }

  private async postChat(
    request: AnalysisRequest,
    controller: AbortController,
    disableReasoning: boolean,
  ): Promise<Response> {
    return await this.fetchImpl(`${this.options.baseUrl}/chat/completions`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.options.apiKey}`,
        ...(this.options.appUrl ? { 'HTTP-Referer': this.options.appUrl } : {}),
        ...(this.options.appTitle ? { 'X-Title': this.options.appTitle } : {}),
      },
      body: JSON.stringify({
        model: this.options.model,
        temperature: this.options.temperature,
        max_tokens: MAX_COMPLETION_TOKENS,
        // Gemma 4 / Gemini thinking would otherwise consume the token budget
        // and leave `message.content` empty.
        ...(disableReasoning ? { reasoning: { effort: 'none' } } : {}),
        provider: {
          allow_fallbacks: true,
        },
        messages: [
          { role: 'system', content: request.instructions },
          { role: 'user', content: request.userMessage },
        ],
      }),
    });
  }

  private async readPayload(response: Response): Promise<ChatCompletionResponse> {
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

    return payload;
  }

  private toHttpError(status: number, body: string): AiProviderError {
    // Truncated so an upstream error can never dump a whole conversation into logs.
    const detail = body.slice(0, 200);
    if (status === 401 || status === 403) {
      return new AiProviderError('AUTH', this.name, 'model host rejected the API key', {
        retryable: false,
      });
    }
    if (status === 402 || status === 429) {
      // Fall back immediately — waiting and retrying a free-tier rate limit is
      // how a 5-second failure becomes a 2-minute one.
      return new AiProviderError('RATE_LIMITED', this.name, 'model host rate limit reached', {
        retryable: false,
      });
    }
    if (status === 408 || status === 504 || status === 524) {
      return new AiProviderError('TIMEOUT', this.name, `model host error ${status}`, {
        retryable: false,
      });
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
