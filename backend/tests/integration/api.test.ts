/**
 * API integration tests.
 *
 * These run the real Fastify app, the real repositories and a real Postgres
 * database. Only the AI provider and the clock are substituted. They cover the
 * API contract, persistence, and scenarios 16, 17 and the storage half of 15.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  analyze,
  buildTestApp,
  closeTestDb,
  getTestDb,
  truncateAll,
  type TestApp,
} from '../helpers/test-app.js';
import { analyses, conversations, entities, followUps, items, segments } from '../../src/db/schema.js';
import type { Database } from '../../src/db/client.js';

let harness: TestApp;
let db: Database;

beforeAll(async () => {
  db = await getTestDb();
  harness = await buildTestApp({ db });
});

afterEach(async () => {
  await truncateAll(db);
});

afterAll(async () => {
  await harness.close();
  await closeTestDb();
});

describe('GET /health', () => {
  it('reports the state of each dependency', async () => {
    const response = await harness.app.inject({ method: 'GET', url: '/health' });
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(body.status).toBe('ok');
    expect(body.checks.database).toBe('ok');
    expect(body.checks.ai_provider).toBe('ok');
    expect(typeof body.uptime_s).toBe('number');
  });

  it('never exposes connection details or credentials', async () => {
    const response = await harness.app.inject({ method: 'GET', url: '/health' });
    const raw = response.body;

    expect(raw).not.toMatch(/postgres:\/\//);
    expect(raw).not.toMatch(/sk-or-/);
    expect(raw).not.toMatch(/password/i);
  });
});

describe('POST /api/v1/conversations/analyze', () => {
  it('returns the documented response shape', async () => {
    const { status, body } = await analyze(harness.app, {
      text: 'I met Arun yesterday in Ahmedabad.',
    });

    expect(status).toBe(200);
    expect(body.conversationId).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.analysis.intent).toBe('LOG');
    expect(Array.isArray(body.analysis.items)).toBe(true);
    expect(body.analysis).toHaveProperty('follow_up');
    expect(body.meta).toMatchObject({ provider: 'local', persisted: true, degraded: false });
  });

  it('stores the original conversation verbatim', async () => {
    const text = '  I met Arun yesterday in Ahmedabad — it was good to see him.  ';
    const { body } = await analyze(harness.app, { text });

    const [row] = await db
      .select()
      .from(conversations)
      .where(eq(conversations.id, body.conversationId));

    // Byte-for-byte, including the surrounding whitespace and the em dash.
    expect(row!.rawText).toBe(text);
    expect(row!.charCount).toBe(text.length);
  });

  it('stores the extracted items, entities and segments', async () => {
    const { body } = await analyze(harness.app, {
      text: 'I met Arun yesterday in Ahmedabad and I need to send him the deck by Friday.',
    });

    const storedItems = await db.select().from(items).where(eq(items.conversationId, body.conversationId));
    const storedEntities = await db.select().from(entities).where(eq(entities.conversationId, body.conversationId));
    const storedSegments = await db.select().from(segments).where(eq(segments.conversationId, body.conversationId));

    expect(storedItems.length).toBe(body.analysis.items.length);
    expect(storedEntities.length).toBe(body.analysis.entities.length);
    expect(storedSegments.length).toBe(body.analysis.segments.length);

    const task = storedItems.find((item) => item.type === 'TASK');
    expect(task).toBeDefined();
    // The resolved date is stored as a real timestamp, so it is queryable.
    expect(task!.occurredAt?.toISOString().slice(0, 10)).toBe('2025-06-13');
    expect(task!.temporalRaw).toBe('by Friday');
  });

  it('links stored items to stored entities', async () => {
    const { body } = await analyze(harness.app, { text: 'I met Arun yesterday in Ahmedabad.' });

    const rows = await db.query.items.findMany({
      where: eq(items.conversationId, body.conversationId),
      with: { itemEntities: { with: { entity: true } } },
    });

    const memory = rows.find((row) => row.type === 'MEMORY');
    expect(memory).toBeDefined();
    const linkedNames = memory!.itemEntities.map((link) => link.entity.name).sort();
    expect(linkedNames).toEqual(['Ahmedabad', 'Arun']);
  });

  it('stores a follow-up question when one was asked', async () => {
    const { body } = await analyze(harness.app, { text: 'Remind me to submit the insurance form.' });

    const rows = await db.select().from(followUps).where(eq(followUps.conversationId, body.conversationId));

    expect(rows).toHaveLength(1);
    expect(rows[0]!.blocking).toBe(true);
    expect(rows[0]!.question).toBe(body.analysis.follow_up.question);
  });

  it('records provider metadata on the analysis row', async () => {
    const { body } = await analyze(harness.app, { text: 'I met Arun yesterday.' });

    const [row] = await db.select().from(analyses).where(eq(analyses.conversationId, body.conversationId));

    expect(row!.provider).toBe('local');
    expect(row!.model).toBe('lifelog-rule-engine-v1');
    expect(row!.degraded).toBe(false);
    expect(row!.schemaVersion).toBe('1.1.0');
  });

  it('resolves relative dates against a client-supplied timestamp', async () => {
    const { body } = await analyze(harness.app, {
      text: 'I met Arun yesterday.',
      occurred_at: '2025-12-25T09:00:00.000Z',
    });

    expect(body.analysis.items[0].temporal.resolved).toBe('2025-12-24');
  });

  it('keeps each conversation independent', async () => {
    const first = await analyze(harness.app, { text: 'I met Arun yesterday.' });
    const second = await analyze(harness.app, { text: 'I need to call Priya tomorrow.' });

    expect(first.body.conversationId).not.toBe(second.body.conversationId);

    const rows = await db.select().from(conversations);
    expect(rows).toHaveLength(2);
  });
});

describe('Scenario 16 — empty input', () => {
  it('rejects an empty string', async () => {
    const { status, body } = await analyze(harness.app, { text: '' });

    expect(status).toBe(400);
    expect(body.error.code).toBe('EMPTY_INPUT');
    expect(body.error.message).toBe('Please provide some text to analyze.');
  });

  it('rejects whitespace-only input', async () => {
    const { status, body } = await analyze(harness.app, { text: '   \n\t  ' });

    expect(status).toBe(400);
    expect(body.error.code).toBe('EMPTY_INPUT');
  });

  it('rejects a missing text field', async () => {
    const { status, body } = await analyze(harness.app, {});

    expect(status).toBe(400);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.details[0].path).toBe('text');
  });

  it('rejects a non-string text field', async () => {
    const { status, body } = await analyze(harness.app, { text: 42 });

    expect(status).toBe(400);
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('does not store anything for a rejected request', async () => {
    await analyze(harness.app, { text: '' });
    const rows = await db.select().from(conversations);
    expect(rows).toHaveLength(0);
  });
});

describe('Scenario 17 — very long input', () => {
  it('analyzes a long but permitted message', async () => {
    const paragraph =
      'I met Arun yesterday in Ahmedabad and we talked about the project for a long time. ';
    const text = paragraph.repeat(60).slice(0, 4_800);

    const { status, body } = await analyze(harness.app, { text });

    expect(status).toBe(200);
    expect(body.analysis.segments.length).toBeGreaterThan(10);

    const [row] = await db.select().from(conversations).where(eq(conversations.id, body.conversationId));
    expect(row!.rawText.length).toBe(text.length);
  });

  it('rejects input beyond the documented ceiling', async () => {
    const { status, body } = await analyze(harness.app, { text: 'a'.repeat(20_001) });

    expect(status).toBe(413);
    expect(body.error.code).toBe('INPUT_TOO_LARGE');
  });

  it('does not fabricate items from repeated text', async () => {
    // The same sentence 40 times is one fact, not forty.
    const text = 'I need to call the bank. '.repeat(40);
    const { body } = await analyze(harness.app, { text });

    expect(body.analysis.items.length).toBeLessThan(5);
  });
});

describe('error handling', () => {
  it('returns a consistent envelope with a request id', async () => {
    const { body } = await analyze(harness.app, { text: '' });

    expect(body).toHaveProperty('error.code');
    expect(body).toHaveProperty('error.message');
    expect(body).toHaveProperty('error.requestId');
  });

  it('returns 404 in the same envelope for an unknown route', async () => {
    const response = await harness.app.inject({ method: 'GET', url: '/api/v1/nope' });
    const body = response.json();

    expect(response.statusCode).toBe(404);
    expect(body.error.code).toBe('NOT_FOUND');
  });

  it('rejects a malformed JSON body without leaking a parser stack', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/conversations/analyze',
      payload: '{"text": "unterminated',
      headers: { 'content-type': 'application/json' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.body).not.toMatch(/at JSON.parse|node_modules|\/workspace\//);
  });

  it('never returns a stack trace or internal path', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/conversations/analyze',
      payload: { text: 42 },
      headers: { 'content-type': 'application/json' },
    });

    expect(response.body).not.toMatch(/\/workspace\/|node_modules|at Object\./);
  });
});

describe('degraded operation', () => {
  it('reports degraded when a fallback provider answered', async () => {
    const { MockProvider } = await import('../../src/ai/mock.provider.js');
    const { LocalRuleProvider } = await import('../../src/ai/local.provider.js');

    const degraded = await buildTestApp({
      db,
      provider: MockProvider.failingWith('TIMEOUT'),
      fallback: new LocalRuleProvider(),
    });

    try {
      const { status, body } = await analyze(degraded.app, { text: 'I met Arun yesterday.' });

      expect(status).toBe(200);
      expect(body.meta.degraded).toBe(true);
      expect(body.meta.provider).toBe('local');
      expect(body.analysis.items.length).toBeGreaterThan(0);
    } finally {
      await degraded.close();
    }
  });

  it('returns 503 when the endpoint has no database', async () => {
    const noDatabase = await buildTestApp({ db: null });

    try {
      const { status, body } = await analyze(noDatabase.app, { text: 'I met Arun yesterday.' });

      expect(status).toBe(503);
      expect(body.error.code).toBe('DATABASE_ERROR');
    } finally {
      await noDatabase.close();
    }
  });
});
