/**
 * Provider selection and failover.
 *
 * Lifelog always has a working reading path. A hosted model is preferred when
 * credentials exist, but a timeout, rate limit or auth failure degrades to the
 * offline rule engine instead of failing the request. Degradation is recorded,
 * never hidden: the response carries `meta.degraded` and a warning explaining
 * which provider answered.
 *
 * Retry policy lives here, not in the adapters, so every provider gets the same
 * behaviour and an adapter stays a thin translation layer.
 *
 * Speed: when a fallback exists it is warmed in parallel with the primary. Free-
 * tier hosts often stall for the full timeout; starting the local engine at the
 * same time means the response is ready the instant the primary gives up —
 * there is no sequential "timeout, then start local" tax.
 */
import type { AppConfig } from '../config/env.js';
import { LocalRuleProvider } from './local.provider.js';
import { OpenRouterProvider } from './openrouter.provider.js';
import { AiProviderError, type AiProvider, type AnalysisRequest, type ProviderResult } from './provider.js';

export interface ProviderAttempt {
  provider: string;
  model: string;
  status: 'ok' | 'error';
  attempt: number;
  latencyMs: number;
  errorKind?: string;
  errorMessage?: string;
}

export interface ResolvedAnalysis extends ProviderResult {
  provider: string;
  model: string;
  /** True when the primary provider failed and the fallback answered. */
  degraded: boolean;
  attempts: ProviderAttempt[];
}

export interface AiRuntimeOptions {
  primary: AiProvider;
  fallback: AiProvider | null;
  maxRetries: number;
}

/** Chooses providers from configuration. `auto` prefers a hosted model. */
export function buildAiRuntime(config: AppConfig, overrides: Partial<AiRuntimeOptions> = {}): AiRuntimeOptions {
  if (overrides.primary) {
    return {
      primary: overrides.primary,
      fallback: overrides.fallback ?? null,
      maxRetries: overrides.maxRetries ?? config.AI_MAX_RETRIES,
    };
  }

  const local = new LocalRuleProvider();

  const openrouter = new OpenRouterProvider({
    apiKey: config.OPENROUTER_API_KEY,
    model: config.AI_MODEL,
    baseUrl: config.OPENROUTER_BASE_URL,
    timeoutMs: config.AI_TIMEOUT_MS,
    temperature: config.AI_TEMPERATURE,
    appUrl: config.OPENROUTER_APP_URL,
    appTitle: config.OPENROUTER_APP_TITLE,
  });

  switch (config.AI_PROVIDER) {
    case 'openrouter':
      return { primary: openrouter, fallback: local, maxRetries: config.AI_MAX_RETRIES };
    case 'local':
    case 'mock':
      return { primary: local, fallback: null, maxRetries: 0 };
    case 'auto':
    default:
      return openrouter.isAvailable()
        ? { primary: openrouter, fallback: local, maxRetries: config.AI_MAX_RETRIES }
        : { primary: local, fallback: null, maxRetries: 0 };
  }
}

function backoffMs(attempt: number): number {
  // 250ms, 500ms, 1000ms — bounded so a slow provider cannot stall a request.
  return Math.min(250 * 2 ** (attempt - 1), 2000);
}

type WarmResult =
  | { status: 'ok'; result: ProviderResult }
  | { status: 'error'; error: AiProviderError }
  | { status: 'skipped' };

/**
 * Starts the fallback without recording attempts yet. Attempt rows are appended
 * only after the primary path finishes, so observability stays ordered:
 * primary attempts first, then fallback.
 */
function warmFallback(provider: AiProvider | null, request: AnalysisRequest): Promise<WarmResult> {
  if (!provider || !provider.isAvailable()) {
    return Promise.resolve({ status: 'skipped' });
  }

  const startedAt = Date.now();
  return provider
    .analyze(request)
    .then(
      (result): WarmResult => ({
        status: 'ok',
        result: {
          ...result,
          latencyMs: result.latencyMs || Date.now() - startedAt,
        },
      }),
    )
    .catch((error: unknown): WarmResult => {
      const aiError =
        error instanceof AiProviderError
          ? error
          : new AiProviderError('UPSTREAM', provider.name, 'unexpected provider failure', {
              cause: error,
            });
      return { status: 'error', error: aiError };
    });
}

/**
 * Runs the primary provider with retries, warming the fallback in parallel.
 * Throws only when every provider fails.
 */
export async function runProviders(
  runtime: AiRuntimeOptions,
  request: AnalysisRequest,
): Promise<ResolvedAnalysis> {
  const attempts: ProviderAttempt[] = [];

  const tryProvider = async (provider: AiProvider, maxRetries: number): Promise<ProviderResult | null> => {
    if (!provider.isAvailable()) {
      attempts.push({
        provider: provider.name,
        model: provider.model,
        status: 'error',
        attempt: 0,
        latencyMs: 0,
        errorKind: 'UNAVAILABLE',
        errorMessage: 'provider not available',
      });
      return null;
    }

    for (let attempt = 1; attempt <= maxRetries + 1; attempt += 1) {
      const startedAt = Date.now();
      try {
        const result = await provider.analyze(request);
        attempts.push({
          provider: provider.name,
          model: provider.model,
          status: 'ok',
          attempt,
          latencyMs: result.latencyMs || Date.now() - startedAt,
        });
        return result;
      } catch (error) {
        const aiError =
          error instanceof AiProviderError
            ? error
            : new AiProviderError('UPSTREAM', provider.name, 'unexpected provider failure', { cause: error });

        attempts.push({
          provider: provider.name,
          model: provider.model,
          status: 'error',
          attempt,
          latencyMs: Date.now() - startedAt,
          errorKind: aiError.kind,
          errorMessage: aiError.message,
        });

        const canRetry = aiError.retryable && attempt <= maxRetries;
        if (!canRetry) return null;
        await new Promise((resolve) => setTimeout(resolve, backoffMs(attempt)));
      }
    }
    return null;
  };

  // Warm fallback while the primary runs so a free-tier timeout does not add
  // a second sequential wait for the offline engine.
  const fallbackWarm = warmFallback(runtime.fallback, request);

  const primaryResult = await tryProvider(runtime.primary, runtime.maxRetries);
  if (primaryResult) {
    // Primary won — discard the warmed fallback (local work is cheap).
    void fallbackWarm;
    return {
      ...primaryResult,
      provider: runtime.primary.name,
      model: runtime.primary.model,
      degraded: false,
      attempts,
    };
  }

  if (runtime.fallback) {
    const warmed = await fallbackWarm;

    if (warmed.status === 'ok') {
      attempts.push({
        provider: runtime.fallback.name,
        model: runtime.fallback.model,
        status: 'ok',
        attempt: 1,
        latencyMs: warmed.result.latencyMs,
      });
      return {
        ...warmed.result,
        provider: runtime.fallback.name,
        model: runtime.fallback.model,
        degraded: true,
        attempts,
      };
    }

    if (warmed.status === 'error') {
      attempts.push({
        provider: runtime.fallback.name,
        model: runtime.fallback.model,
        status: 'error',
        attempt: 1,
        latencyMs: 0,
        errorKind: warmed.error.kind,
        errorMessage: warmed.error.message,
      });
    } else {
      // Was unavailable at warm time — try once more through the normal path.
      const fallbackResult = await tryProvider(runtime.fallback, 0);
      if (fallbackResult) {
        return {
          ...fallbackResult,
          provider: runtime.fallback.name,
          model: runtime.fallback.model,
          degraded: true,
          attempts,
        };
      }
    }
  }

  const last = attempts[attempts.length - 1];
  throw new AiProviderError(
    (last?.errorKind as AiProviderError['kind']) ?? 'UNAVAILABLE',
    runtime.primary.name,
    last?.errorMessage ?? 'no AI provider could analyze the conversation',
    { retryable: false },
  );
}
