import { describe, expect, it, vi } from 'vitest';
import { OpenRouterProvider } from '../../src/ai/openrouter.provider.js';
import type { AnalysisRequest } from '../../src/ai/provider.js';

const request: AnalysisRequest = {
  text: 'I met Arun yesterday.',
  now: new Date('2025-06-11T10:00:00.000Z'),
  timezone: null,
  instructions: 'return json',
  userMessage: 'I met Arun yesterday.',
};

const goodJson = '{"intent":"LOG","entities":[],"items":[]}';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function makeProvider(fetchImpl: typeof fetch): OpenRouterProvider {
  return new OpenRouterProvider({
    apiKey: 'test-key',
    model: 'google/gemma-4-26b-a4b-it:free',
    baseUrl: 'https://openrouter.ai/api/v1',
    timeoutMs: 4_000,
    temperature: 0.1,
    fetchImpl,
  });
}

const asFetch = (impl: (...args: Parameters<typeof fetch>) => ReturnType<typeof fetch>): typeof fetch =>
  impl as typeof fetch;

describe('OpenRouterProvider', () => {
  it('disables reasoning so thinking tokens cannot empty the reply', async () => {
    const fetchImpl = vi.fn(async (_url: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { reasoning?: { effort?: string }; max_tokens?: number };
      expect(body.reasoning).toEqual({ effort: 'none' });
      expect(body.max_tokens).toBeGreaterThanOrEqual(2000);
      return jsonResponse({ choices: [{ message: { content: goodJson } }] });
    });

    const result = await makeProvider(asFetch(fetchImpl)).analyze(request);
    expect(result.raw).toMatchObject({ intent: 'LOG' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('reads content when the host returns an array of parts', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        choices: [{ message: { content: [{ type: 'text', text: goodJson }] } }],
      }),
    );

    const result = await makeProvider(asFetch(fetchImpl)).analyze(request);
    expect(result.raw).toMatchObject({ intent: 'LOG', items: [] });
    expect(result.rawText).toContain('LOG');
  });

  it('retries once when the first reply has empty content', async () => {
    const fetchImpl = vi.fn(async () => {
      if (fetchImpl.mock.calls.length === 1) {
        return jsonResponse({ choices: [{ message: { content: '' }, finish_reason: 'length' }] });
      }
      return jsonResponse({ choices: [{ message: { content: goodJson } }] });
    });

    const result = await makeProvider(asFetch(fetchImpl)).analyze(request);
    expect(result.raw).toMatchObject({ intent: 'LOG' });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('retries without the reasoning parameter when the host rejects it', async () => {
    const fetchImpl = vi.fn(async (_url: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { reasoning?: unknown };
      if (body.reasoning) {
        return jsonResponse({ error: { message: 'unknown field reasoning' } }, 400);
      }
      return jsonResponse({ choices: [{ message: { content: goodJson } }] });
    });

    const result = await makeProvider(asFetch(fetchImpl)).analyze(request);
    expect(result.raw).toMatchObject({ intent: 'LOG' });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
