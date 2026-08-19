/**
 * Applies the SQL migrations in `backend/drizzle/`.
 *
 * Run with `npm run db:migrate`. Safe to run repeatedly — Drizzle records which
 * migrations have already been applied.
 */
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../config/env.js';
import { createDb } from './client.js';

const migrationsFolder = resolve(dirname(fileURLToPath(import.meta.url)), '../../drizzle');

export async function runMigrations(databaseUrl: string): Promise<void> {
  const handle = createDb({ url: databaseUrl, maxConnections: 1 });
  try {
    await migrate(handle.db, { migrationsFolder });
  } finally {
    await handle.close();
  }
}

const isDirectRun = process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop()!);

if (isDirectRun) {
  const config = loadConfig();
  if (!config.databaseUrl) {
    console.error('DATABASE_URL is not set. Copy .env.example to .env first.');
    process.exit(1);
  }
  runMigrations(config.databaseUrl)
    .then(() => {
      console.log('Migrations applied.');
      process.exit(0);
    })
    .catch((error: unknown) => {
      console.error('Migration failed:', error instanceof Error ? error.message : error);
      process.exit(1);
    });
}
