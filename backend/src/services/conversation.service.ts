/**
 * Conversation service.
 *
 * Orchestration only. It decides the *order* of operations and how failures
 * combine; it does not decide what an item is (intelligence layer), how to talk
 * to a model (AI provider), or how to write a row (repository).
 *
 * The ordering is the interesting part:
 *
 *   1. Store the conversation first. What the user said must survive even if
 *      everything downstream fails.
 *   2. Analyse.
 *   3. Store the analysis. If this fails, still return the analysis and mark the
 *      response `persisted: false` — losing the user's words is unacceptable,
 *      losing a derived interpretation is merely annoying, and re-analysis can
 *      recover it later.
 */
import type { AiRuntimeOptions } from '../ai/registry.js';
import { AiProviderError } from '../ai/provider.js';
import { AppError } from '../errors/app-error.js';
import { understandConversation } from '../intelligence/pipeline.js';
import type { AnalysisRepository } from '../repositories/analysis.repository.js';
import type { ConversationRepository } from '../repositories/conversation.repository.js';
import type { Analysis } from '../schemas/analysis.schema.js';
import type { AnalyzeRequest } from '../schemas/api.schema.js';

export interface AnalyzeResult {
  conversationId: string;
  analysisId: string | null;
  analysis: Analysis;
  provider: string;
  model: string;
  degraded: boolean;
  persisted: boolean;
  latencyMs: number;
}

export interface ConversationServiceDeps {
  conversations: ConversationRepository;
  analyses: AnalysisRepository;
  runtime: AiRuntimeOptions;
  /** Injected so tests can pin "now" instead of depending on the wall clock. */
  clock?: () => Date;
  logger?: {
    warn: (context: Record<string, unknown>, message: string) => void;
    error: (context: Record<string, unknown>, message: string) => void;
  };
}

/** Maps a provider failure onto the client-facing error taxonomy. */
function toAppError(error: unknown): AppError {
  if (error instanceof AiProviderError) {
    switch (error.kind) {
      case 'TIMEOUT':
        return new AppError('AI_TIMEOUT', error.message, { cause: error });
      case 'BAD_OUTPUT':
        return new AppError('AI_INVALID_OUTPUT', error.message, { cause: error });
      case 'RATE_LIMITED':
        return new AppError('RATE_LIMITED', error.message, { cause: error });
      case 'AUTH':
      case 'UNAVAILABLE':
      case 'NETWORK':
      case 'UPSTREAM':
      default:
        return new AppError('AI_UNAVAILABLE', error.message, { cause: error });
    }
  }
  if (error instanceof AppError) return error;
  return AppError.internal('conversation analysis failed', error);
}

export class ConversationService {
  private readonly clock: () => Date;

  constructor(private readonly deps: ConversationServiceDeps) {
    this.clock = deps.clock ?? (() => new Date());
  }

  async analyze(request: AnalyzeRequest): Promise<AnalyzeResult> {
    const now = request.occurred_at ? new Date(request.occurred_at) : this.clock();
    const timezone = request.timezone ?? null;

    // --- 1. Preserve the conversation --------------------------------------
    // A failure here is fatal: Lifelog will not analyse text it cannot keep,
    // because an analysis with nothing to point back at is unverifiable.
    let conversationId: string;
    try {
      const conversation = await this.deps.conversations.create({
        rawText: request.text,
        occurredAt: now,
        timezone,
        source: 'api',
        clientMeta: request.client ?? {},
      });
      conversationId = conversation.id;
    } catch (error) {
      this.deps.logger?.error({ err: String(error) }, 'failed to store conversation');
      throw new AppError('DATABASE_ERROR', 'failed to store conversation', { cause: error });
    }

    // --- 2. Understand -----------------------------------------------------
    let understanding: Awaited<ReturnType<typeof understandConversation>>;
    try {
      understanding = await understandConversation(this.deps.runtime, {
        text: request.text,
        now,
        timezone,
      });
    } catch (error) {
      this.deps.logger?.error({ conversationId, err: String(error) }, 'analysis failed');
      throw toAppError(error);
    }

    // --- 3. Persist the interpretation -------------------------------------
    let analysisId: string | null = null;
    let persisted = false;
    try {
      const result = await this.deps.analyses.persist({
        conversationId,
        analysis: understanding.analysis,
        provider: understanding.provider,
        model: understanding.model,
        degraded: understanding.degraded,
        latencyMs: understanding.latencyMs,
        attempts: understanding.attempts,
      });
      analysisId = result.analysisId;
      persisted = true;

      await this.deps.conversations.setLanguage(conversationId, understanding.analysis.language);
    } catch (error) {
      // Deliberately non-fatal. The conversation is safe and the analysis is
      // still returned; it can be recomputed and re-stored later.
      this.deps.logger?.warn(
        { conversationId, err: String(error) },
        'analysis produced but not persisted',
      );
      understanding.analysis.warnings.push({
        code: 'ANALYSIS_NOT_PERSISTED',
        message: 'the analysis was produced but could not be saved',
      });
    }

    return {
      conversationId,
      analysisId,
      analysis: understanding.analysis,
      provider: understanding.provider,
      model: understanding.model,
      degraded: understanding.degraded,
      persisted,
      latencyMs: understanding.latencyMs,
    };
  }
}
