/**
 * Configuration loading and validation.
 *
 * Configuration is read exactly once, at startup, and validated with Zod. If
 * the process starts, the config is known-good — no module needs to re-check
 * `process.env` or invent defaults of its own.
 *
 * Precedence, highest first:
 *   1. Real process environment (container/CI injected).
 *   2. `.env` at the repository root.
 *   3. `secrets/API-KEYS.md` (secrets only).
 */
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { z } from 'zod';
import { loadKeysFile, type KeysFileResult } from './keys-file.js';

const here = dirname(fileURLToPath(import.meta.url));

/** Walks up from this file to the directory containing `backend/`. */
function findRepoRoot(start: string): string {
  let dir = start;
  for (let i = 0; i < 8; i += 1) {
    if (existsSync(resolve(dir, 'backend')) && existsSync(resolve(dir, 'package.json'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return resolve(start, '../../..');
}

export const REPO_ROOT = findRepoRoot(here);

const booleanish = z
  .string()
  .optional()
  .transform((value) => value === 'true' || value === '1');

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  PORT: z.coerce.number().int().min(1).max(65535).default(4319),
  HOST: z.string().default('0.0.0.0'),
  CORS_ORIGINS: z.string().default('http://localhost:5319,http://127.0.0.1:5319'),

  DATABASE_URL: z.string().min(1).optional(),
  TEST_DATABASE_URL: z.string().min(1).optional(),
  DB_MAX_CONNECTIONS: z.coerce.number().int().min(1).max(50).default(10),
  /** When true the API still answers if the database is unreachable. */
  ALLOW_DEGRADED_PERSISTENCE: booleanish,

  AI_PROVIDER: z.enum(['auto', 'openrouter', 'local', 'mock']).default('auto'),
  AI_MODEL: z.string().default('google/gemma-4-26b-a4b-it:free'),
  /** Hard cap on the hosted model. Keep short: free-tier queues stall often. */
  AI_TIMEOUT_MS: z.coerce.number().int().min(1000).max(300_000).default(20_000),
  AI_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(0),
  AI_TEMPERATURE: z.coerce.number().min(0).max(2).default(0.1),
  OPENROUTER_API_KEY: z.string().min(1).optional(),
  OPENROUTER_BASE_URL: z.string().url().default('https://openrouter.ai/api/v1'),
  OPENROUTER_APP_URL: z.string().default('http://localhost:5319'),
  OPENROUTER_APP_TITLE: z.string().default('Lifelog'),

  MAX_INPUT_CHARS: z.coerce.number().int().min(100).max(20_000).default(20_000),
  RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(60),
  RATE_LIMIT_WINDOW: z.string().default('1 minute'),
});

export type RawEnv = z.infer<typeof EnvSchema>;

export interface AppConfig extends RawEnv {
  readonly repoRoot: string;
  readonly isProduction: boolean;
  readonly isTest: boolean;
  readonly corsOrigins: string[];
  /** Resolved connection string for the current NODE_ENV. */
  readonly databaseUrl: string | undefined;
  /** Report from the keys file loader, for startup logging and /health. */
  readonly keysFile: KeysFileResult;
  readonly hasAiCredentials: boolean;
}

let cached: AppConfig | null = null;

export interface LoadConfigOptions {
  /** Skip the module-level cache. Used by tests. */
  fresh?: boolean;
  /** Extra values layered on top of the environment. Used by tests. */
  overrides?: Record<string, string | undefined>;
}

export function loadConfig(options: LoadConfigOptions = {}): AppConfig {
  if (cached && !options.fresh) return cached;

  // `.env` never overrides an already-injected variable.
  dotenv.config({ path: resolve(REPO_ROOT, '.env'), override: false });

  const keysFile = loadKeysFile({ rootDir: REPO_ROOT });

  const source = { ...process.env, ...options.overrides };
  const parsed = EnvSchema.safeParse(source);

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid configuration:\n${issues}`);
  }

  const env = parsed.data;
  const isTest = env.NODE_ENV === 'test';
  const databaseUrl = isTest ? (env.TEST_DATABASE_URL ?? env.DATABASE_URL) : env.DATABASE_URL;

  const config: AppConfig = {
    ...env,
    repoRoot: REPO_ROOT,
    isProduction: env.NODE_ENV === 'production',
    isTest,
    corsOrigins: env.CORS_ORIGINS.split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
    databaseUrl,
    keysFile,
    hasAiCredentials: Boolean(env.OPENROUTER_API_KEY),
  };

  if (!options.fresh) cached = config;
  return config;
}

/** Clears the cached config. Tests only. */
export function resetConfigCache(): void {
  cached = null;
}
