import { describe, expect, it, vi } from 'vitest';
import { GeminiProvider } from '../../src/ai/gemini.provider.js';
import { AiProviderError, type AnalysisRequest } from '../../src/ai/provider.js';
import { buildAiRuntime } from '../../src/ai/registry.js';
import { loadConfig } from '../../src/config/env.js';

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

function makeProvider(fetchImpl: typeof fetch, apiKey: string | undefined = 'test-key'): GeminiProvider {
  return new GeminiProvider({
    apiKey,
    model: 'gemini-flash-latest',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    timeoutMs: 4_000,
    temperature: 0.1,
    fetchImpl,
  });
}

const asFetch = (impl: (...args: Parameters<typeof fetch>) => ReturnType<typeof fetch>): typeof fetch =>
  impl as typeof fetch;

describe('GeminiProvider', () => {
  it('sends the prompt to generateContent and requests JSON output', async () => {
    const fetchImpl = vi.fn(async (url: Parameters<typeof fetch>[0], init?: RequestInit) => {
      expect(String(url).endsWith('/models/gemini-flash-latest:generateContent')).toBe(true);
      expect(new Headers(init?.headers).get('X-goog-api-key')).toBe('test-key');

      const body = JSON.parse(String(init?.body)) as {
        systemInstruction?: { parts?: Array<{ text?: string }> };
        contents?: Array<{ parts?: Array<{ text?: string }> }>;
        generationConfig?: { responseMimeType?: string; maxOutputTokens?: number };
      };
      expect(body.systemInstruction?.parts?.[0]?.text).toBe(request.instructions);
      expect(body.contents?.[0]?.parts?.[0]?.text).toBe(request.userMessage);
      expect(body.generationConfig?.responseMimeType).toBe('application/json');
      expect(body.generationConfig?.maxOutputTokens).toBeGreaterThanOrEqual(2_000);

      return jsonResponse({ candidates: [{ content: { parts: [{ text: goodJson }] } }] });
    });

    const result = await makeProvider(asFetch(fetchImpl)).analyze(request);
    expect(result.raw).toMatchObject({ intent: 'LOG', items: [] });
    expect(result.exchange?.request).toMatchObject({
      systemInstruction: { parts: [{ text: request.instructions }] },
    });
    expect(result.exchange?.response).toMatchObject({
      candidates: [{ content: { parts: [{ text: goodJson }] } }],
    });
  });

  it('joins response parts and records Gemini token usage', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        candidates: [{ content: { parts: [{ text: goodJson.slice(0, 20) }, { text: goodJson.slice(20) }] } }],
        usageMetadata: {
          promptTokenCount: 120,
          candidatesTokenCount: 30,
          totalTokenCount: 150,
        },
      }),
    );

    const result = await makeProvider(asFetch(fetchImpl)).analyze(request);
    expect(result.raw).toMatchObject({ intent: 'LOG' });
    expect(result.usage).toEqual({
      promptTokens: 120,
      completionTokens: 30,
      totalTokens: 150,
      source: 'provider',
    });
  });

  it('maps rejected credentials without exposing the response body', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: { message: 'sensitive upstream detail' } }, 403));

    await expect(makeProvider(asFetch(fetchImpl)).analyze(request)).rejects.toMatchObject({
      kind: 'AUTH',
      provider: 'gemini',
      message: 'Gemini rejected the API key',
    } satisfies Partial<AiProviderError>);
  });

  it('is unavailable without a key', async () => {
    const provider = new GeminiProvider({
      apiKey: undefined,
      model: 'gemini-flash-latest',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      timeoutMs: 4_000,
      temperature: 0.1,
      fetchImpl: asFetch(vi.fn()),
    });

    expect(provider.isAvailable()).toBe(false);
    await expect(provider.analyze(request)).rejects.toMatchObject({ kind: 'UNAVAILABLE' });
  });

  it('registers explicit Gemini with no fallback or local comparison draft', () => {
    const config = loadConfig({
      fresh: true,
      overrides: {
        AI_PROVIDER: 'gemini',
        GEMINI_API_KEY: 'test-key',
        GEMINI_MODEL: 'gemini-flash-latest',
      },
    });

    const runtime = buildAiRuntime(config);
    expect(runtime.primary.name).toBe('gemini');
    expect(runtime.fallback).toBeNull();
    expect(runtime.runLocalDraft).toBe(false);
  });

  it('selects Gemini in auto mode when it is the available hosted credential', () => {
    const config = loadConfig({
      fresh: true,
      overrides: {
        AI_PROVIDER: 'auto',
        GEMINI_API_KEY: 'test-key',
        OPENROUTER_API_KEY: undefined,
      },
    });

    const runtime = buildAiRuntime(config);
    expect(runtime.primary.name).toBe('gemini');
    expect(runtime.fallback).toBeNull();
    expect(runtime.runLocalDraft).toBe(false);
  });
});
