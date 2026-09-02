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
import { AiProviderError, type ProviderUsage } from '../ai/provider.js';
import { AppError } from '../errors/app-error.js';
import { understandConversation } from '../intelligence/pipeline.js';
import type { ActionItemRepository } from '../repositories/action-item.repository.js';
import type { AnalysisRepository } from '../repositories/analysis.repository.js';
import type { ConversationRepository } from '../repositories/conversation.repository.js';
import type { MemoryService } from './memory.service.js';
import type { Analysis } from '../schemas/analysis.schema.js';
import type {
  AnalyzeRequest,
  ExtractedObject,
  NoteDetail,
  NoteListQuery,
  NoteListResponse,
  Relationship,
  UpdateNoteRequest,
} from '../schemas/api.schema.js';

export interface AnalyzeResult {
  conversationId: string;
  analysisId: string | null;
  analysis: Analysis;
  provider: string;
  model: string;
  degraded: boolean;
  persisted: boolean;
  latencyMs: number;
  usage: ProviderUsage;
  aiExchange: { provider: string; model: string; request: unknown; response: unknown } | null;
}

export interface ConversationServiceDeps {
  conversations: ConversationRepository;
  analyses: AnalysisRepository;
  /** Optional: when present, tasks and reminders are de-duplicated and tracked. */
  actionItems?: ActionItemRepository;
  /** Optional: when present, memory graph objects and relationships are built. */
  memoryService?: MemoryService;
  runtime: AiRuntimeOptions;
  /** Injected so tests can pin "now" instead of depending on the wall clock. */
  clock?: () => Date;
  logger?: {
    info?: (context: Record<string, unknown>, message: string) => void;
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

    const source = request.source ?? (request.client as any)?.source ?? 'api';

    // --- 1. Preserve the conversation --------------------------------------
    // A failure here is fatal: Lifelog will not analyse text it cannot keep,
    // because an analysis with nothing to point back at is unverifiable.
    let conversationId: string;
    try {
      const conversation = await this.deps.conversations.create({
        rawText: request.text,
        occurredAt: now,
        timezone,
        source,
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
      await this.deps.conversations.updateProcessingStatus(conversationId, 'processed');

      // --- 4. Track tasks and reminders ------------------------------------
      // Restating an obligation must not create a second one, so this merges on
      // the action key and records where each mention came from.
      if (this.deps.actionItems) {
        const entityById = new Map(
          understanding.analysis.entities.map((entity) => [entity.id, entity]),
        );

        for (const item of understanding.analysis.items) {
          if (item.type !== 'TASK' && item.type !== 'REMINDER') continue;

          const entityNames = item.entity_ids
            .map((localId) => entityById.get(localId)?.name)
            .filter((name): name is string => Boolean(name));

          const dbEntityIds = item.entity_ids
            .map((localId) => result.entityIds[localId])
            .filter((value): value is string => Boolean(value));

          try {
            await this.deps.actionItems.record({
              kind: item.type,
              title: item.title,
              displayText:
                typeof item.details.display_text === 'string'
                  ? item.details.display_text
                  : item.summary || item.title,
              sourceText: item.source_text,
              conversationText: request.text,
              conversationId,
              itemId: result.itemIds[item.id] ?? null,
              provider: understanding.provider,
              priority:
                typeof item.details.priority === 'string' ? item.details.priority : 'NORMAL',
              dueAt: item.temporal.resolved ? new Date(item.temporal.resolved) : null,
              temporalRaw: item.temporal.raw,
              recurrence: item.temporal.recurrence,
              entityIds: dbEntityIds,
              entityNames,
            });
          } catch (error) {
            // Tracking is a convenience over the stored analysis; failing it
            // must not fail the request.
            this.deps.logger?.warn(
              { conversationId, itemType: item.type, err: String(error) },
              'could not track action item',
            );
          }
        }
      }

      // --- 5. Build memory graph objects & connections ---------------------
      if (this.deps.memoryService) {
        try {
          await this.deps.memoryService.processAnalysis({
            conversationId,
            analysis: understanding.analysis,
            analysisId,
            entityIds: result.entityIds,
            itemIds: result.itemIds,
          });
        } catch (error) {
          this.deps.logger?.warn(
            { conversationId, err: String(error) },
            'could not process memory objects for analysis',
          );
        }
      }
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

    this.deps.logger?.info?.(
      {
        conversationId,
        provider: understanding.provider,
        model: understanding.model,
        prompt_tokens: understanding.usage.promptTokens ?? 0,
        completion_tokens: understanding.usage.completionTokens ?? 0,
        total_tokens: understanding.usage.totalTokens ?? 0,
        usage_source: understanding.usage.source,
        latency_ms: understanding.latencyMs,
        degraded: understanding.degraded,
        persisted,
      },
      'conversation analyzed',
    );

    return {
      conversationId,
      analysisId,
      analysis: understanding.analysis,
      provider: understanding.provider,
      model: understanding.model,
      degraded: understanding.degraded,
      persisted,
      latencyMs: understanding.latencyMs,
      usage: understanding.usage,
      aiExchange: understanding.aiExchange,
    };
  }

  // ---------------------------------------------------------------------------
  // Notes & Journal API
  // ---------------------------------------------------------------------------

  /**
   * Paginated note/journal listing with filtering/search, newest first.
   */
  async listNotes(filters: NoteListQuery): Promise<NoteListResponse> {
    const [noteRows, total] = await Promise.all([
      this.deps.conversations.list(filters),
      this.deps.conversations.count({
        from: filters.from,
        to: filters.to,
        source: filters.source,
        search: filters.search,
      }),
    ]);

    // For each note, look up its latest analysis to include the journal if available
    const notesWithJournal = await Promise.all(
      noteRows.map(async (row) => {
        const latestAnalysis = await this.deps.conversations.findLatestAnalysis(row.id);
        const analysisData = latestAnalysis?.analysis as Record<string, unknown> | undefined;
        const journal = analysisData?.journal as Record<string, unknown> | undefined;

        return {
          id: row.id,
          original_text: row.originalText,
          created_at: row.createdAt.toISOString(),
          updated_at: row.updatedAt.toISOString(),
          occurred_at: row.occurredAt ? row.occurredAt.toISOString() : row.createdAt.toISOString(),
          timezone: row.timezone,
          language: row.language,
          source: row.source,
          processing_status: row.processingStatus,
          journal: journal
            ? {
                title: String(journal.title || 'Personal Journal Entry'),
                polished_entry: String(journal.polished_entry || row.originalText),
                mood: String(journal.mood || 'Neutral'),
                highlights: Array.isArray(journal.highlights)
                  ? journal.highlights.map(String)
                  : [],
              }
            : {
                title: String(analysisData?.summary || 'Journal Entry'),
                polished_entry: row.originalText,
                mood: 'Neutral',
                highlights: analysisData?.summary ? [String(analysisData.summary)] : [],
              },
        };
      }),
    );

    return {
      notes: notesWithJournal,
      pagination: {
        page: filters.page,
        limit: filters.limit,
        total,
        total_pages: Math.max(1, Math.ceil(total / filters.limit)),
      },
    };
  }

  /**
   * Fetch a single note with its extracted objects, relationships, and journal.
   */
  async getNote(id: string): Promise<NoteDetail | null> {
    const note = await this.deps.conversations.findNoteById(id);
    if (!note) return null;

    const latestAnalysis = await this.deps.conversations.findLatestAnalysis(id);
    const objects: ExtractedObject[] = [];
    const relationships: Relationship[] = [];
    const analysisData = latestAnalysis?.analysis as Record<string, unknown> | undefined;
    const journal = analysisData?.journal as Record<string, unknown> | undefined;

    if (latestAnalysis?.id) {
      const analysisId = latestAnalysis.id;
      const [entityRows, itemRows] = await Promise.all([
        this.deps.conversations.findEntitiesByAnalysis(analysisId),
        this.deps.conversations.findItemsByAnalysis(analysisId),
      ]);

      const entityNameById = new Map(entityRows.map((e) => [e.id, e.name]));

      for (const entity of entityRows) {
        objects.push({
          id: entity.id,
          type: 'entity',
          name: entity.name,
          kind: entity.kind,
          confidence: entity.confidence,
        });
      }

      for (const item of itemRows) {
        objects.push({
          id: item.id,
          type: item.type,
          name: item.title,
          summary: item.summary || undefined,
          source_text: item.sourceText || undefined,
          confidence: item.confidence,
          details:
            item.details && typeof item.details === 'object' && Object.keys(item.details).length > 0
              ? (item.details as Record<string, unknown>)
              : undefined,
        });
      }

      const itemIds = itemRows.map((i) => i.id);
      if (itemIds.length > 0) {
        const links = await this.deps.conversations.findItemEntityLinks(itemIds);
        const itemNameById = new Map(itemRows.map((i) => [i.id, i.title]));
        for (const link of links) {
          const itemName = itemNameById.get(link.itemId) ?? link.itemId;
          const entityName = entityNameById.get(link.entityId) ?? link.entityId;
          relationships.push({
            source_object: entityName,
            target_object: itemName,
            relationship_type: link.role,
          });
        }
      }
    }

    return {
      id: note.id,
      original_text: note.originalText,
      created_at: note.createdAt.toISOString(),
      updated_at: note.updatedAt.toISOString(),
      occurred_at: note.occurredAt ? note.occurredAt.toISOString() : note.createdAt.toISOString(),
      timezone: note.timezone,
      language: note.language,
      source: note.source,
      processing_status: note.processingStatus,
      journal: journal
        ? {
            title: String(journal.title || 'Personal Journal Entry'),
            polished_entry: String(journal.polished_entry || note.originalText),
            mood: String(journal.mood || 'Neutral'),
            highlights: Array.isArray(journal.highlights)
              ? journal.highlights.map(String)
              : [],
          }
        : {
            title: String(analysisData?.summary || 'Journal Entry'),
            polished_entry: note.originalText,
            mood: 'Neutral',
            highlights: analysisData?.summary ? [String(analysisData.summary)] : [],
          },
      objects,
      relationships,
    };
  }

  /**
   * Update a note's journal entry or original text.
   */
  async updateNote(id: string, updates: UpdateNoteRequest): Promise<NoteDetail | null> {
    const existing = await this.deps.conversations.findNoteById(id);
    if (!existing) return null;

    await this.deps.conversations.updateNoteJournal(id, updates);
    return this.getNote(id);
  }

  /** Delete a note and all records owned exclusively by its conversation. */
  async deleteNote(id: string): Promise<boolean> {
    return this.deps.conversations.delete(id);
  }
}
