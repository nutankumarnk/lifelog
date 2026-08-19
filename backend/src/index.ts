/**
 * Process entry point.
 *
 * Responsible for startup ordering, the startup banner and graceful shutdown.
 * Nothing else. Application wiring lives in `server.ts`.
 */
import { loadConfig } from './config/env.js';
import { closeDb } from './db/client.js';
import { APP_VERSION, buildServer } from './server.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const { app } = await buildServer({ config });

  // Report the keys file by *name* only. Values are never logged or echoed.
  if (config.keysFile.found) {
    app.log.info(
      { loaded: config.keysFile.loaded, skipped: config.keysFile.skipped.length },
      'loaded secrets from secrets/API-KEYS.md',
    );
    for (const warning of config.keysFile.warnings) app.log.warn(warning);
  }

  if (!config.hasAiCredentials) {
    app.log.warn(
      'No OPENROUTER_API_KEY found — using the offline rule engine. ' +
        'Add a key to secrets/API-KEYS.md to enable the hosted model.',
    );
  }

  if (!config.databaseUrl) {
    app.log.warn('No DATABASE_URL configured — conversation analysis is disabled.');
  }

  await app.listen({ port: config.PORT, host: config.HOST });

  app.log.info(
    {
      version: APP_VERSION,
      provider: config.AI_PROVIDER,
      model: config.hasAiCredentials ? config.AI_MODEL : 'lifelog-rule-engine-v1',
    },
    `Lifelog backend listening on http://${config.HOST}:${config.PORT}`,
  );

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, 'shutting down');
    try {
      await app.close();
      await closeDb();
      process.exit(0);
    } catch (error) {
      app.log.error({ err: String(error) }, 'shutdown failed');
      process.exit(1);
    }
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((error: unknown) => {
  // The logger may not exist yet, so this is the one place console is used.
  console.error('Failed to start Lifelog backend:', error instanceof Error ? error.message : error);
  process.exit(1);
});
