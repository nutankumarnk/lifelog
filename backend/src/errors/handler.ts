/**
 * The single error boundary.
 *
 * Every error that escapes a route passes through here and leaves as the same
 * envelope. Two rules:
 *
 *   1. Clients get a code, a safe message and a request id. Never a stack, a
 *      SQL fragment, a provider hostname or an internal message.
 *   2. Operators get the full detail in the log, with credentials redacted.
 *
 * The request id is the join between the two, so a user can quote it in a
 * support request and an operator can find the real cause.
 *
 * See docs/error-handling.md.
 */
import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { AppError, isAppError } from './app-error.js';
import type { ErrorResponse } from '../schemas/api.schema.js';
import { redactSecrets } from '../utils/redact.js';

/** Postgres SQLSTATE prefixes that mean "the database is the problem". */
const DATABASE_ERROR_HINTS = ['ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', '57P', '08', '53'];

function looksLikeDatabaseError(error: unknown): boolean {
  const code = (error as { code?: unknown })?.code;
  if (typeof code !== 'string') return false;
  return DATABASE_ERROR_HINTS.some((hint) => code.startsWith(hint));
}

function toAppError(error: unknown): AppError {
  if (isAppError(error)) return error;

  if (error instanceof ZodError) {
    return AppError.validation(
      error.issues.map((issue) => ({
        path: issue.path.join('.') || 'body',
        message: issue.message,
      })),
    );
  }

  const fastifyError = error as FastifyError;

  if (fastifyError?.code === 'FST_ERR_VALIDATION') {
    return AppError.validation([{ path: 'body', message: 'request body failed validation' }]);
  }
  if (fastifyError?.code === 'FST_ERR_CTP_INVALID_MEDIA_TYPE') {
    return AppError.validation([{ path: 'content-type', message: 'expected application/json' }]);
  }
  if (fastifyError?.code === 'FST_ERR_CTP_EMPTY_JSON_BODY' || fastifyError?.code === 'FST_ERR_CTP_INVALID_JSON_BODY') {
    return AppError.validation([{ path: 'body', message: 'request body must be valid JSON' }]);
  }
  if (fastifyError?.statusCode === 429) {
    return new AppError('RATE_LIMITED', 'rate limit exceeded');
  }
  if (fastifyError?.statusCode === 404) {
    return new AppError('NOT_FOUND', 'route not found');
  }
  if (looksLikeDatabaseError(error)) {
    return new AppError('DATABASE_ERROR', 'database unavailable', { cause: error });
  }

  return AppError.internal(
    error instanceof Error ? error.message : 'unhandled error',
    error,
  );
}

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error: FastifyError, request: FastifyRequest, reply: FastifyReply) => {
    const appError = toAppError(error);

    const logContext = {
      requestId: request.id,
      code: appError.code,
      statusCode: appError.statusCode,
      method: request.method,
      url: request.url,
      // Redacted because an upstream message can contain a key or a fragment of
      // the user's conversation.
      reason: redactSecrets(appError.message),
    };

    if (appError.statusCode >= 500) {
      request.log.error({ ...logContext, stack: appError.stack }, 'request failed');
    } else {
      request.log.warn(logContext, 'request rejected');
    }

    const body: ErrorResponse = {
      error: {
        code: appError.code,
        message: appError.publicMessage,
        ...(appError.details.length > 0 ? { details: appError.details } : {}),
        requestId: String(request.id),
      },
    };

    reply.code(appError.statusCode).send(body);
  });

  app.setNotFoundHandler((request: FastifyRequest, reply: FastifyReply) => {
    const body: ErrorResponse = {
      error: {
        code: 'NOT_FOUND',
        message: 'The requested resource does not exist.',
        requestId: String(request.id),
      },
    };
    reply.code(404).send(body);
  });
}
