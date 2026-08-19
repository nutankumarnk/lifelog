/**
 * Health routes.
 *
 * `/health` reports whether Lifelog can actually do its job, not merely whether
 * the process is alive. It never reveals connection strings, key values or
 * provider hostnames — a health endpoint is usually unauthenticated.
 */
import type { FastifyInstance } from 'fastify';
import type { AiRuntimeOptions } from '../ai/registry.js';
import { pingDatabase, type Database } from '../db/client.js';
import type { HealthResponse } from '../schemas/api.schema.js';

export interface HealthRoutesOptions {
  db: Database | null;
  runtime: AiRuntimeOptions;
  version: string;
  startedAt: number;
}

export async function registerHealthRoutes(
  app: FastifyInstance,
  options: HealthRoutesOptions,
): Promise<void> {
  app.get('/health', async (_request, reply): Promise<HealthResponse> => {
    const databaseOk = options.db ? await pingDatabase(options.db) : null;
    const primaryAvailable = options.runtime.primary.isAvailable();
    const fallbackAvailable = options.runtime.fallback?.isAvailable() ?? false;

    const database = databaseOk === null ? 'skipped' : databaseOk ? 'ok' : 'error';
    const aiProvider = primaryAvailable ? 'ok' : fallbackAvailable ? 'degraded' : 'error';

    // Degraded means Lifelog still answers requests but not at full quality;
    // error means a core dependency is gone.
    const status =
      database === 'error' || aiProvider === 'error' ? 'error' : aiProvider === 'degraded' ? 'degraded' : 'ok';

    reply.code(status === 'error' ? 503 : 200);
    return {
      status,
      uptime_s: Number(((Date.now() - options.startedAt) / 1000).toFixed(1)),
      version: options.version,
      checks: { database, ai_provider: aiProvider },
    };
  });
}
