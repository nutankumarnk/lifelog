/**
 * Token accounting for a model call.
 *
 * Hosted providers report counts; the offline engine estimates them. Either way
 * Lifelog records the number so a request's cost is visible, not guessed later
 * from logs. Conversation text never appears here — only integer counts.
 */
import type { ProviderUsage } from './provider.js';

/** ~4 characters per token. Good enough to compare requests; not a bill. */
export function estimateTokenCount(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return Math.max(1, Math.ceil(trimmed.length / 4));
}

export function estimateUsage(prompt: string, completion: string): ProviderUsage {
  const promptTokens = estimateTokenCount(prompt);
  const completionTokens = estimateTokenCount(completion);
  return {
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
    source: 'estimated',
  };
}

export function reportedUsage(
  promptTokens: number | undefined,
  completionTokens: number | undefined,
  totalTokens?: number,
): ProviderUsage | undefined {
  if (promptTokens == null && completionTokens == null && totalTokens == null) {
    return undefined;
  }

  const prompt = promptTokens ?? 0;
  const completion = completionTokens ?? 0;
  return {
    promptTokens: prompt,
    completionTokens: completion,
    totalTokens: totalTokens ?? prompt + completion,
    source: 'provider',
  };
}

export function sumUsage(parts: Array<ProviderUsage | undefined>): ProviderUsage | undefined {
  const present = parts.filter((part): part is ProviderUsage => Boolean(part));
  if (present.length === 0) return undefined;

  const promptTokens = present.reduce((sum, part) => sum + (part.promptTokens ?? 0), 0);
  const completionTokens = present.reduce((sum, part) => sum + (part.completionTokens ?? 0), 0);
  const source = present.some((part) => part.source === 'provider') ? 'provider' : 'estimated';

  return {
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
    source,
  };
}

export function usageOrEstimate(
  usage: ProviderUsage | undefined,
  prompt: string,
  completion: string,
): ProviderUsage {
  return usage ?? estimateUsage(prompt, completion);
}
