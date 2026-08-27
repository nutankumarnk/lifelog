import { describe, expect, it } from 'vitest';
import { estimateTokenCount, estimateUsage, reportedUsage, sumUsage } from '../../src/ai/usage.js';

describe('token usage', () => {
  it('estimates at roughly four characters per token', () => {
    expect(estimateTokenCount('')).toBe(0);
    expect(estimateTokenCount('abcd')).toBe(1);
    expect(estimateTokenCount('abcdefgh')).toBe(2);
  });

  it('sums host-reported counts across retries', () => {
    const first = reportedUsage(100, 20, 120);
    const second = reportedUsage(100, 40, 140);
    const total = sumUsage([first, second]);

    expect(total).toMatchObject({
      promptTokens: 200,
      completionTokens: 60,
      totalTokens: 260,
      source: 'provider',
    });
  });

  it('prefers provider source when mixing estimated and reported counts', () => {
    const mixed = sumUsage([estimateUsage('hello world', '{"ok":true}'), reportedUsage(10, 5)]);
    expect(mixed?.source).toBe('provider');
    expect(mixed?.totalTokens).toBeGreaterThan(15);
  });
});
