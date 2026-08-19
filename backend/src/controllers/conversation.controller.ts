/**
 * Conversation controller.
 *
 * The HTTP-shaped edge of the conversation feature: validate input, call the
 * service, shape the response. No business rules, no SQL, no model calls.
 * If logic starts appearing here, it belongs in a service.
 */
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AppError } from '../errors/app-error.js';
import { AnalyzeRequestSchema, type AnalyzeResponse } from '../schemas/api.schema.js';
import type { ConversationService } from '../services/conversation.service.js';
import { ANALYSIS_SCHEMA_VERSION } from '../schemas/analysis.schema.js';

export class ConversationController {
  constructor(private readonly service: ConversationService) {}

  analyze = async (request: FastifyRequest, reply: FastifyReply): Promise<AnalyzeResponse> => {
    const parsed = AnalyzeRequestSchema.safeParse(request.body);

    if (!parsed.success) {
      const details = parsed.error.issues.map((issue) => ({
        path: issue.path.join('.') || 'body',
        message: issue.message,
      }));

      // Empty and oversized input get their own codes so a client can give the
      // user a useful message instead of a generic validation failure.
      const body = request.body as { text?: unknown } | undefined;
      if (typeof body?.text === 'string' && body.text.trim().length === 0) {
        throw new AppError('EMPTY_INPUT', 'text was empty or whitespace only', { details });
      }
      if (typeof body?.text === 'string' && body.text.length > 20_000) {
        throw new AppError('INPUT_TOO_LARGE', 'text exceeded the maximum length', { details });
      }
      throw AppError.validation(details);
    }

    const result = await this.service.analyze(parsed.data);

    reply.code(200);
    return {
      conversationId: result.conversationId,
      // A conversation always exists; an analysis row may not if the write
      // failed. The all-zero UUID marks "analysed but not stored".
      analysisId: result.analysisId ?? '00000000-0000-0000-0000-000000000000',
      analysis: result.analysis,
      meta: {
        provider: result.provider,
        model: result.model,
        degraded: result.degraded,
        persisted: result.persisted,
        latency_ms: result.latencyMs,
        schema_version: ANALYSIS_SCHEMA_VERSION,
      },
    };
  };
}
