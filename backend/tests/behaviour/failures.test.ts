/**
 * Failure-path tests — scenarios 13, 14 and part of 15 from docs/testing.md.
 *
 * A life-logging system is judged by what it does on a bad day. These tests
 * cover the cases where the model is down, the model lies about its output
 * format, or the database refuses a write, and assert that Lifelog degrades in
 * a defined way rather than an accidental one.
 */
import { describe, expect, it, vi } from 'vitest';
import { AiProviderError } from '../../src/ai/provider.js';
import { MockProvider } from '../../src/ai/mock.provider.js';
import { LocalRuleProvider } from '../../src/ai/local.provider.js';
import { runProviders } from '../../src/ai/registry.js';
import { understandConversation } from '../../src/intelligence/pipeline.js';
import { ConversationService } from '../../src/services/conversation.service.js';
import { AppError } from '../../src/errors/app-error.js';
import { FIXED_NOW } from '../helpers/test-app.js';

const request = {
  text: 'I met Arun yesterday.',
  now: FIXED_NOW,
  timezone: null,
  instructions: 'test',
  userMessage: 'test',
};

describe('Scenario 13 — AI failure', () => {
  it('falls back to the offline provider when the primary times out', async () => {
    const primary = MockProvider.failingWith('TIMEOUT', 'took too long');
    const result = await understandConversation(
      { primary, fallback: new LocalRuleProvider(), maxRetries: 0 },
      { text: 'I met Arun yesterday.', now: FIXED_NOW, timezone: null },
    );

    expect(result.degraded).toBe(true);
    expect(result.provider).toBe('local');
    // The user still gets a real analysis.
    expect(result.analysis.items.length).toBeGreaterThan(0);
    expect(result.analysis.warnings.some((warning) => warning.code === 'PROVIDER_DEGRADED')).toBe(true);
  });

  it('retries a retryable failure before giving up', async () => {
    const provider = new MockProvider([
      { kind: 'fail', error: new AiProviderError('RATE_LIMITED', 'mock', 'slow down') },
      { kind: 'respond', payload: { intent: 'LOG', entities: [], items: [] } },
    ]);

    const result = await runProviders({ primary: provider, fallback: null, maxRetries: 2 }, request);

    expect(provider.calls).toHaveLength(2);
    expect(result.degraded).toBe(false);
    expect(result.attempts.filter((attempt) => attempt.status === 'error')).toHaveLength(1);
  });

  it('does not retry a non-retryable failure', async () => {
    const provider = MockProvider.failingWith('AUTH', 'bad key');

    await expect(
      runProviders({ primary: provider, fallback: null, maxRetries: 3 }, request),
    ).rejects.toBeInstanceOf(AiProviderError);

    expect(provider.calls).toHaveLength(1);
  });

  it('throws when every provider fails', async () => {
    const primary = MockProvider.failingWith('UPSTREAM', 'model host is down');
    const fallback = MockProvider.failingWith('UNAVAILABLE', 'also down');

    await expect(
      understandConversation({ primary, fallback, maxRetries: 0 }, { text: 'hello', now: FIXED_NOW, timezone: null }),
    ).rejects.toBeInstanceOf(AiProviderError);
  });

  it('records every attempt for observability', async () => {
    const primary = MockProvider.failingWith('NETWORK', 'connection reset');
    const result = await understandConversation(
      { primary, fallback: new LocalRuleProvider(), maxRetries: 0 },
      { text: 'I met Arun yesterday.', now: FIXED_NOW, timezone: null },
    );

    expect(result.attempts).toHaveLength(2);
    expect(result.attempts[0]).toMatchObject({ provider: 'mock', status: 'error', errorKind: 'NETWORK' });
    expect(result.attempts[1]).toMatchObject({ provider: 'local', status: 'ok' });
  });
});

describe('Scenario 14 — invalid AI JSON', () => {
  it('recovers JSON wrapped in a markdown fence', async () => {
    const provider = new MockProvider([
      {
        kind: 'respondText',
        text: 'Here is the analysis:\n```json\n{"intent":"LOG","entities":[],"items":[]}\n```\nHope that helps!',
      },
    ]);

    const result = await understandConversation(
      { primary: provider, fallback: null, maxRetries: 0 },
      { text: 'I met Arun.', now: FIXED_NOW, timezone: null },
    );

    expect(result.analysis.intent).toBe('LOG');
    expect(result.degraded).toBe(false);
  });

  it('recovers JSON with trailing commas', async () => {
    const provider = new MockProvider([
      { kind: 'respondText', text: '{"intent":"LOG","entities":[],"items":[],}' },
    ]);

    const result = await understandConversation(
      { primary: provider, fallback: null, maxRetries: 0 },
      { text: 'I met Arun.', now: FIXED_NOW, timezone: null },
    );

    expect(result.analysis.intent).toBe('LOG');
  });

  it('recovers a response truncated by a token limit', async () => {
    const provider = new MockProvider([
      {
        kind: 'respondText',
        text: '{"intent":"LOG","items":[{"id":"i1","type":"PAST_EVENT","title":"Met Arun","source_text":"I met Arun"',
      },
    ]);

    const result = await understandConversation(
      { primary: provider, fallback: null, maxRetries: 0 },
      { text: 'I met Arun.', now: FIXED_NOW, timezone: null },
    );

    expect(result.analysis.items).toHaveLength(1);
    expect(result.analysis.items[0]!.type).toBe('PAST_EVENT');
  });

  it('falls back when the output is not JSON at all', async () => {
    const provider = new MockProvider([
      { kind: 'respondText', text: "I'm sorry, I can't help with that request." },
    ]);

    const result = await understandConversation(
      { primary: provider, fallback: new LocalRuleProvider(), maxRetries: 0 },
      { text: 'I met Arun yesterday.', now: FIXED_NOW, timezone: null },
    );

    expect(result.degraded).toBe(true);
    expect(result.analysis.items.length).toBeGreaterThan(0);
  });

  it('repairs structurally valid JSON with the wrong field types', async () => {
    const provider = MockProvider.respondingWith({
      intent: 'journaling', // not a Lifelog intent
      intent_confidence: '0.8', // string instead of number
      entities: 'Arun', // string instead of array
      items: [
        {
          type: 'todo', // alias
          title: 'Call Arun',
          source_text: 'I need to call Arun',
          confidence: 'high', // unparseable
          temporal: 'tomorrow', // string instead of object
        },
      ],
    });

    const result = await understandConversation(
      { primary: provider, fallback: null, maxRetries: 0 },
      { text: 'I need to call Arun tomorrow.', now: FIXED_NOW, timezone: null },
    );

    expect(result.analysis.items).toHaveLength(1);
    expect(result.analysis.items[0]!.type).toBe('TASK');
    expect(result.analysis.items[0]!.temporal.resolved).toBe('2025-06-12');
    expect(typeof result.analysis.items[0]!.confidence).toBe('number');
  });

  it('drops items whose type cannot be mapped at all', async () => {
    const provider = MockProvider.respondingWith({
      intent: 'LOG',
      entities: [],
      items: [
        { type: 'PAST_EVENT', title: 'Met Arun', source_text: 'I met Arun' },
        { type: 'astrological_sign', title: 'Something', source_text: 'I met Arun' },
      ],
    });

    const result = await understandConversation(
      { primary: provider, fallback: null, maxRetries: 0 },
      { text: 'I met Arun.', now: FIXED_NOW, timezone: null },
    );

    expect(result.analysis.items).toHaveLength(1);
    expect(result.analysis.warnings.some((warning) => warning.code === 'ITEM_DROPPED')).toBe(true);
  });
});

describe('Scenario 15 — database failure', () => {
  const analysisRequest = { text: 'I met Arun yesterday in Ahmedabad.' };

  it('refuses the request when the conversation itself cannot be stored', async () => {
    const service = new ConversationService({
      conversations: {
        create: vi.fn().mockRejectedValue(new Error('connection refused')),
        setLanguage: vi.fn(),
        findById: vi.fn(),
      } as never,
      analyses: { persist: vi.fn() } as never,
      runtime: { primary: new LocalRuleProvider(), fallback: null, maxRetries: 0 },
      clock: () => FIXED_NOW,
    });

    // Analysing text Lifelog cannot keep would produce an interpretation with
    // nothing to point back at, so the request fails instead.
    await expect(service.analyze(analysisRequest)).rejects.toMatchObject({ code: 'DATABASE_ERROR' });
  });

  it('still returns the analysis when only the extraction write fails', async () => {
    const setLanguage = vi.fn();
    const service = new ConversationService({
      conversations: {
        create: vi.fn().mockResolvedValue({
          id: '11111111-1111-4111-8111-111111111111',
          rawText: analysisRequest.text,
          occurredAt: FIXED_NOW,
          timezone: null,
          createdAt: FIXED_NOW,
        }),
        setLanguage,
        findById: vi.fn(),
      } as never,
      analyses: { persist: vi.fn().mockRejectedValue(new Error('deadlock detected')) } as never,
      runtime: { primary: new LocalRuleProvider(), fallback: null, maxRetries: 0 },
      clock: () => FIXED_NOW,
    });

    const result = await service.analyze(analysisRequest);

    // The conversation is safe and the user still sees their analysis.
    expect(result.conversationId).toBeTruthy();
    expect(result.persisted).toBe(false);
    expect(result.analysis.items.length).toBeGreaterThan(0);
    expect(result.analysis.warnings.some((warning) => warning.code === 'ANALYSIS_NOT_PERSISTED')).toBe(true);
  });

  it('maps a provider failure onto the client error taxonomy', async () => {
    const service = new ConversationService({
      conversations: {
        create: vi.fn().mockResolvedValue({
          id: '11111111-1111-4111-8111-111111111111',
          rawText: analysisRequest.text,
          occurredAt: FIXED_NOW,
          timezone: null,
          createdAt: FIXED_NOW,
        }),
        setLanguage: vi.fn(),
        findById: vi.fn(),
      } as never,
      analyses: { persist: vi.fn() } as never,
      runtime: {
        primary: MockProvider.failingWith('TIMEOUT', 'model took too long'),
        fallback: null,
        maxRetries: 0,
      },
      clock: () => FIXED_NOW,
    });

    await expect(service.analyze(analysisRequest)).rejects.toMatchObject({
      code: 'AI_TIMEOUT',
      statusCode: 504,
    });
  });

  it('never puts an internal message into the client-facing error', async () => {
    const error = new AppError('DATABASE_ERROR', 'connection to 10.0.0.5:5432 refused (password auth failed)');

    expect(error.publicMessage).not.toContain('10.0.0.5');
    expect(error.publicMessage).not.toContain('password');
    expect(error.publicMessage).toBe('Lifelog could not save that right now. Please try again shortly.');
  });
});
