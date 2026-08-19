/**
 * Database connection management.
 *
 * The pool is created lazily so that unit tests, `--help`-style invocations and
 * the local AI provider all work without a running Postgres.
 */
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import * as schema from './schema.js';

export type Database = PostgresJsDatabase<typeof schema>;

export interface DbHandle {
  db: Database;
  client: postgres.Sql;
  close: () => Promise<void>;
}

let handle: DbHandle | null = null;

export interface CreateDbOptions {
  url: string;
  maxConnections?: number;
  /** Fail fast rather than queue forever when Postgres is down. */
  connectTimeoutSeconds?: number;
}

export function createDb(options: CreateDbOptions): DbHandle {
  const client = postgres(options.url, {
    max: options.maxConnections ?? 10,
    connect_timeout: options.connectTimeoutSeconds ?? 10,
    idle_timeout: 30,
    // Silence postgres.js notices; Lifelog logs through its own logger.
    onnotice: () => {},
    // Never let the driver print connection strings on error.
    debug: false,
  });

  const db = drizzle(client, { schema });

  return {
    db,
    client,
    close: async () => {
      await client.end({ timeout: 5 });
    },
  };
}

/** Returns the process-wide handle, creating it on first use. */
export function getDb(url: string, maxConnections?: number): DbHandle {
  if (!handle) {
    handle = createDb({ url, maxConnections });
  }
  return handle;
}

export async function closeDb(): Promise<void> {
  if (handle) {
    await handle.close();
    handle = null;
  }
}

/** Cheap liveness probe used by /health. */
export async function pingDatabase(db: Database): Promise<boolean> {
  try {
    await db.execute(sql`select 1`);
    return true;
  } catch {
    return false;
  }
}

export { schema };
