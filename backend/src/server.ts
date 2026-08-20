/**
 * Fastify application assembly.
 *
 * This is the composition root: the one place that knows how every module fits
 * together. Dependencies are constructed here and injected downward, which is
 * what lets a test build the same app with a mock provider and no database.
 *
 * Nothing here contains business logic.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { buildAiRuntime, type AiRuntimeOptions } from './ai/registry.js';
import { loadConfig, type AppConfig } from './config/env.js';
import { getDb, type Database } from './db/client.js';
import { ConversationController } from './controllers/conversation.controller.js';
import { ReminderController, TaskController } from './controllers/task.controller.js';
import { registerErrorHandler } from './errors/handler.js';
import { ActionItemRepository } from './repositories/action-item.repository.js';
import { AnalysisRepository } from './repositories/analysis.repository.js';
import { ConversationRepository } from './repositories/conversation.repository.js';
import { registerConversationRoutes } from './routes/conversations.route.js';
import { registerHealthRoutes } from './routes/health.route.js';
import { registerActionRoutes } from './routes/tasks.route.js';
import { ConversationService } from './services/conversation.service.js';
import { summarizeText } from './utils/redact.js';

export const APP_VERSION = '1.0.0';

export interface BuildServerOptions {
  config?: AppConfig;
  /** Supply a database to skip the config-driven connection. Tests use this. */
  db?: Database | null;
  /** Override provider selection. Tests use this to inject the mock provider. */
  runtime?: Partial<AiRuntimeOptions>;
  clock?: () => Date;
}

export interface BuiltServer {
  app: FastifyInstance;
  config: AppConfig;
  runtime: AiRuntimeOptions;
  db: Database | null;
}

export async function buildServer(options: BuildServerOptions = {}): Promise<BuiltServer> {
  const config = options.config ?? loadConfig();
  const startedAt = Date.now();

  const app = Fastify({
    logger: {
      level: config.LOG_LEVEL,
      // Conversation text must never reach a log line; only its shape does.
      redact: {
        paths: ['req.headers.authorization', 'req.headers.cookie', 'req.body.text'],
        censor: '[redacted]',
      },
      serializers: {
        req: (request) => ({
          method: request.method,
          url: request.url,
          id: request.id,
        }),
      },
    },
    // Longer than AI_TIMEOUT_MS so a slow hosted reply is not killed by Node.
    requestTimeout: 120_000,
    connectionTimeout: 0,
    // Reject oversized bodies at the transport layer, before any parsing.
    bodyLimit: config.MAX_INPUT_CHARS * 4 + 4096,
    trustProxy: config.isProduction,
  });

  // --- Security middleware -------------------------------------------------
  await app.register(helmet, {
    // The API serves JSON only; a CSP for a non-HTML response adds no value
    // and complicates the test console's proxying.
    contentSecurityPolicy: false,
  });

  await app.register(cors, {
    origin: config.corsOrigins.length > 0 ? config.corsOrigins : false,
    methods: ['GET', 'POST', 'PATCH', 'OPTIONS'],
    credentials: false,
  });

  await app.register(rateLimit, {
    max: config.RATE_LIMIT_MAX,
    timeWindow: config.RATE_LIMIT_WINDOW,
  });

  registerErrorHandler(app);

  // --- Dependencies --------------------------------------------------------
  const db =
    options.db !== undefined
      ? options.db
      : config.databaseUrl
        ? getDb(config.databaseUrl, config.DB_MAX_CONNECTIONS).db
        : null;

  const runtime = buildAiRuntime(config, options.runtime);

  if (db) {
    const actionItems = new ActionItemRepository(db);

    const service = new ConversationService({
      conversations: new ConversationRepository(db),
      analyses: new AnalysisRepository(db),
      actionItems,
      runtime,
      clock: options.clock,
      logger: {
        warn: (context, message) => app.log.warn(context, message),
        error: (context, message) => app.log.error(context, message),
      },
    });

    await registerConversationRoutes(app, { controller: new ConversationController(service) });
    await registerActionRoutes(app, {
      tasks: new TaskController(actionItems),
      reminders: new ReminderController(actionItems),
    });
  } else {
    // Without a database Lifelog cannot honour its own guarantee that the
    // conversation is preserved, so the endpoint refuses rather than pretending.
    app.log.warn('no DATABASE_URL configured — /api/v1/conversations/analyze is disabled');
    app.post('/api/v1/conversations/analyze', async (_request, reply) => {
      reply.code(503).send({
        error: {
          code: 'DATABASE_ERROR',
          message: 'Lifelog could not save that right now. Please try again shortly.',
        },
      });
    });
  }

  await registerHealthRoutes(app, { db, runtime, version: APP_VERSION, startedAt });

  // --- Request-shape logging ----------------------------------------------
  app.addHook('onRequest', async (request) => {
    request.log.debug({ method: request.method, url: request.url }, 'request received');
  });

  app.addHook('preHandler', async (request) => {
    const body = request.body as { text?: unknown } | undefined;
    if (typeof body?.text === 'string') {
      // Length, word count and a hash. Never the content.
      request.log.info({ input: summarizeText(body.text) }, 'analyzing conversation');
    }
  });

  return { app, config, runtime, db };
}
