/**
 * Test harness.
 *
 * Builds the real Fastify app with real repositories against the test database,
 * so integration tests exercise the same code path as production. Only two
 * things are substituted: the AI provider (deterministic) and the clock
 * (pinned), because neither can be asserted on otherwise.
 */
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { createDb, type Database, type DbHandle } from '../../src/db/client.js';
import { loadConfig, type AppConfig } from '../../src/config/env.js';
import { runMigrations } from '../../src/db/migrate.js';
import { buildServer } from '../../src/server.js';
import { LocalRuleProvider } from '../../src/ai/local.provider.js';
import type { AiProvider } from '../../src/ai/provider.js';
import type { Analysis, Item, ItemType } from '../../src/schemas/analysis.schema.js';

/**
 * The pinned reference time for every test.
 * Wednesday 2025-06-11 10:00 UTC — a midweek date, so "next Monday",
 * "last Friday" and "the weekend" all resolve unambiguously.
 */
export const FIXED_NOW = new Date('2025-06-11T10:00:00.000Z');

let handle: DbHandle | null = null;
let migrated = false;

export function testConfig(): AppConfig {
  return loadConfig({ fresh: true });
}

/** Returns the test database, running migrations once per process. */
export async function getTestDb(): Promise<Database> {
  const config = testConfig();
  const url = config.TEST_DATABASE_URL ?? config.DATABASE_URL;
  if (!url) throw new Error('TEST_DATABASE_URL is not configured');

  if (!handle) {
    if (!migrated) {
      await runMigrations(url);
      migrated = true;
    }
    handle = createDb({ url, maxConnections: 4 });
  }
  return handle.db;
}

export async function closeTestDb(): Promise<void> {
  if (handle) {
    await handle.close();
    handle = null;
  }
}

/** Clears every table. Called between tests so assertions on counts are exact. */
export async function truncateAll(db: Database): Promise<void> {
  await db.execute(
    sql`TRUNCATE TABLE item_entities, items, entities, segments, follow_ups, ai_invocations, analyses, conversations RESTART IDENTITY CASCADE`,
  );
}

export interface TestAppOptions {
  provider?: AiProvider;
  fallback?: AiProvider | null;
  maxRetries?: number;
  /** Pass null to build the app with no database, for failure-path tests. */
  db?: Database | null;
  now?: Date;
}

export interface TestApp {
  app: FastifyInstance;
  db: Database | null;
  close: () => Promise<void>;
}

export async function buildTestApp(options: TestAppOptions = {}): Promise<TestApp> {
  const db = options.db !== undefined ? options.db : await getTestDb();

  const built = await buildServer({
    config: testConfig(),
    db,
    runtime: {
      primary: options.provider ?? new LocalRuleProvider(),
      fallback: options.fallback ?? null,
      maxRetries: options.maxRetries ?? 0,
    },
    clock: () => options.now ?? FIXED_NOW,
  });

  await built.app.ready();

  return {
    app: built.app,
    db,
    close: async () => {
      await built.app.close();
    },
  };
}

/** POSTs to the analyze endpoint and returns the parsed body. */
export async function analyze(
  app: FastifyInstance,
  body: unknown,
): Promise<{ status: number; body: any }> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/conversations/analyze',
    payload: body as Record<string, unknown>,
    headers: { 'content-type': 'application/json' },
  });

  return { status: response.statusCode, body: response.json() };
}

/** Runs the intelligence pipeline directly, with no HTTP or database involved. */
export async function understand(text: string, provider?: AiProvider, now = FIXED_NOW) {
  const { understandConversation } = await import('../../src/intelligence/pipeline.js');
  return understandConversation(
    { primary: provider ?? new LocalRuleProvider(), fallback: null, maxRetries: 0 },
    { text, now, timezone: null },
  );
}

/** Convenience: all items of a given type from an analysis. */
export function itemsOfType(analysis: Analysis, type: ItemType): Item[] {
  return analysis.items.filter((item) => item.type === type);
}
