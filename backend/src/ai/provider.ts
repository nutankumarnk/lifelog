/**
 * The AI provider boundary.
 *
 * This is the *only* interface the rest of Lifelog knows about. Nothing outside
 * `src/ai/` may import an SDK, mention a model name, or handle an HTTP response
 * from a model host. Swapping Gemma for another model, or a hosted API for a
 * local runtime, must not require touching the intelligence layer, the service
 * layer or the schema.
 *
 * A provider's job is narrow: take a prompt, return text or a parsed object.
 * It does not decide what an item is, resolve dates, or choose follow-ups —
 * that is Lifelog's intelligence layer. See docs/ai-engine.md.
 */

export interface AnalysisRequest {
  /** The user's original text, untouched. */
  text: string;
  /** Reference time for resolving relative expressions. */
  now: Date;
  timezone: string | null;
  /**
   * Model-facing instructions, authored by the intelligence layer. Providers
   * relay them verbatim and must never edit, extend or reinterpret them —
   * otherwise Lifelog's rules would start to differ per model.
   */
  instructions: string;
  /** The user-role message content, also built by the intelligence layer. */
  userMessage: string;
}

export interface ProviderUsage {
  promptTokens?: number;
  completionTokens?: number;
}

export interface ProviderResult {
  /** Whatever the provider produced, before any Lifelog validation. */
  raw: unknown;
  /** The exact text returned by the model, for debugging. Empty for rule engines. */
  rawText: string;
  usage?: ProviderUsage;
  latencyMs: number;
}

export interface AiProvider {
  /** Stable adapter id: "openrouter", "local", "mock". */
  readonly name: string;
  /** Model identifier, or a sentinel like "rule-engine" for non-model providers. */
  readonly model: string;
  /** False when the provider cannot run (e.g. missing API key). */
  isAvailable(): boolean;
  /**
   * Produce a best-effort structured reading of the conversation.
   * Implementations must throw `AiProviderError` on failure, never return junk.
   */
  analyze(request: AnalysisRequest): Promise<ProviderResult>;
}

export type AiErrorKind =
  | 'UNAVAILABLE' // No credentials, or provider disabled.
  | 'TIMEOUT'
  | 'RATE_LIMITED'
  | 'AUTH' // Rejected credentials.
  | 'NETWORK'
  | 'BAD_OUTPUT' // Responded, but not with usable JSON.
  | 'UPSTREAM'; // Any other non-2xx from the model host.

/**
 * The single error type crossing the provider boundary.
 *
 * `message` is safe to log but is never returned to an API client verbatim —
 * upstream errors sometimes echo request content back.
 */
export class AiProviderError extends Error {
  readonly kind: AiErrorKind;
  readonly provider: string;
  readonly retryable: boolean;

  constructor(
    kind: AiErrorKind,
    provider: string,
    message: string,
    options: { retryable?: boolean; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = 'AiProviderError';
    this.kind = kind;
    this.provider = provider;
    this.retryable =
      options.retryable ?? (kind === 'TIMEOUT' || kind === 'RATE_LIMITED' || kind === 'NETWORK');
  }
}
