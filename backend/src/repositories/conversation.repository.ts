/**
 * Conversation persistence.
 *
 * Every SQL statement Lifelog issues for conversations lives in this file.
 * Services call methods here; they never build queries, and they never see a
 * Drizzle type. That boundary is what makes it possible to change the storage
 * engine later without touching business logic.
 *
 * The conversation row is written *before* analysis begins. If the model call
 * or the extraction write then fails, what the user said is still safe — which
 * is the entire point of treating the conversation as the source of truth.
 */
import { and, desc, eq, gte, ilike, inArray, lte, type SQL, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import {
  analyses,
  conversations,
  entities,
  itemEntities,
  items,
} from '../db/schema.js';

export interface NewConversation {
  rawText: string;
  occurredAt: Date;
  timezone: string | null;
  language?: string | null;
  source?: string;
  clientMeta?: Record<string, unknown>;
  userId?: string | null;
}

export interface ConversationRecord {
  id: string;
  rawText: string;
  occurredAt: Date;
  timezone: string | null;
  createdAt: Date;
}

export interface NoteListFilters {
  from?: string;
  to?: string;
  source?: string;
  search?: string;
  page: number;
  limit: number;
}

export interface NoteCountFilters {
  from?: string;
  to?: string;
  source?: string;
  search?: string;
}

export interface NoteListItem {
  id: string;
  originalText: string;
  source: string;
  processingStatus: string;
  createdAt: Date;
  updatedAt: Date;
  occurredAt: Date;
  timezone: string | null;
  language: string | null;
}

export class ConversationRepository {
  constructor(private readonly db: Database) {}

  async create(input: NewConversation): Promise<ConversationRecord> {
    const [row] = await this.db
      .insert(conversations)
      .values({
        userId: input.userId ?? null,
        rawText: input.rawText,
        charCount: input.rawText.length,
        language: input.language ?? null,
        occurredAt: input.occurredAt,
        timezone: input.timezone,
        source: input.source ?? 'api',
        clientMeta: input.clientMeta ?? {},
        processingStatus: 'pending',
      })
      .returning({
        id: conversations.id,
        rawText: conversations.rawText,
        occurredAt: conversations.occurredAt,
        timezone: conversations.timezone,
        createdAt: conversations.createdAt,
      });

    if (!row) throw new Error('conversation insert returned no row');
    return row;
  }

  /** Records the detected language once analysis has run. */
  async setLanguage(id: string, language: string): Promise<void> {
    await this.db.update(conversations).set({ language, updatedAt: new Date() }).where(eq(conversations.id, id));
  }

  async findById(id: string): Promise<ConversationRecord | null> {
    const [row] = await this.db
      .select({
        id: conversations.id,
        rawText: conversations.rawText,
        occurredAt: conversations.occurredAt,
        timezone: conversations.timezone,
        createdAt: conversations.createdAt,
      })
      .from(conversations)
      .where(eq(conversations.id, id))
      .limit(1);

    return row ?? null;
  }

  // ---------------------------------------------------------------------------
  // Notes / Journal API queries
  // ---------------------------------------------------------------------------

  async updateProcessingStatus(id: string, status: string): Promise<void> {
    await this.db
      .update(conversations)
      .set({ processingStatus: status, updatedAt: new Date() })
      .where(eq(conversations.id, id));
  }

  private applyConditions(filters: NoteCountFilters): SQL | undefined {
    const conditions: SQL[] = [];

    if (filters.from) {
      conditions.push(gte(conversations.createdAt, new Date(`${filters.from}T00:00:00.000Z`)));
    }
    if (filters.to) {
      conditions.push(lte(conversations.createdAt, new Date(`${filters.to}T23:59:59.999Z`)));
    }
    if (filters.source) {
      conditions.push(eq(conversations.source, filters.source));
    }
    if (filters.search) {
      conditions.push(ilike(conversations.rawText, `%${filters.search}%`));
    }

    return conditions.length > 0 ? and(...conditions) : undefined;
  }

  async list(filters: NoteListFilters): Promise<NoteListItem[]> {
    const offset = (filters.page - 1) * filters.limit;

    return this.db
      .select({
        id: conversations.id,
        originalText: conversations.rawText,
        source: conversations.source,
        processingStatus: conversations.processingStatus,
        createdAt: conversations.createdAt,
        updatedAt: conversations.updatedAt,
        occurredAt: conversations.occurredAt,
        timezone: conversations.timezone,
        language: conversations.language,
      })
      .from(conversations)
      .where(this.applyConditions(filters))
      .orderBy(desc(conversations.createdAt))
      .limit(filters.limit)
      .offset(offset);
  }

  async count(filters: NoteCountFilters): Promise<number> {
    const [row] = await this.db
      .select({ count: sql`count(*)::int` })
      .from(conversations)
      .where(this.applyConditions(filters));

    return (row?.count as number) ?? 0;
  }

  async findNoteById(id: string): Promise<NoteListItem | null> {
    const [row] = await this.db
      .select({
        id: conversations.id,
        originalText: conversations.rawText,
        source: conversations.source,
        processingStatus: conversations.processingStatus,
        createdAt: conversations.createdAt,
        updatedAt: conversations.updatedAt,
        occurredAt: conversations.occurredAt,
        timezone: conversations.timezone,
        language: conversations.language,
      })
      .from(conversations)
      .where(eq(conversations.id, id))
      .limit(1);

    return row ?? null;
  }

  /**
   * Deletes the source conversation. Database cascades remove interpretations
   * and per-conversation provenance while shared cross-note records survive.
   */
  async delete(id: string): Promise<boolean> {
    const deleted = await this.db
      .delete(conversations)
      .where(eq(conversations.id, id))
      .returning({ id: conversations.id });

    return deleted.length > 0;
  }

  async findLatestAnalysis(conversationId: string): Promise<{ id: string; analysis: Record<string, unknown> } | null> {
    const [row] = await this.db
      .select({
        id: analyses.id,
        analysis: analyses.analysis,
      })
      .from(analyses)
      .where(eq(analyses.conversationId, conversationId))
      .orderBy(desc(analyses.createdAt))
      .limit(1);

    return (row as { id: string; analysis: Record<string, unknown> }) ?? null;
  }

  async updateNoteJournal(
    conversationId: string,
    journalUpdate: {
      title?: string;
      polished_entry?: string;
      mood?: string;
      highlights?: string[];
      original_text?: string;
    },
  ): Promise<void> {
    if (journalUpdate.original_text !== undefined) {
      await this.db
        .update(conversations)
        .set({
          rawText: journalUpdate.original_text,
          charCount: journalUpdate.original_text.length,
          updatedAt: new Date(),
        })
        .where(eq(conversations.id, conversationId));
    } else {
      await this.db
        .update(conversations)
        .set({ updatedAt: new Date() })
        .where(eq(conversations.id, conversationId));
    }

    const latest = await this.findLatestAnalysis(conversationId);
    if (latest) {
      const currentAnalysis = (latest.analysis || {}) as Record<string, unknown>;
      const currentJournal = (currentAnalysis.journal || {}) as Record<string, unknown>;

      const mergedJournal = {
        title: journalUpdate.title ?? currentJournal.title ?? 'Personal Journal Entry',
        polished_entry: journalUpdate.polished_entry ?? currentJournal.polished_entry ?? '',
        mood: journalUpdate.mood ?? currentJournal.mood ?? 'Neutral',
        highlights: journalUpdate.highlights ?? currentJournal.highlights ?? [],
      };

      const updatedAnalysis = {
        ...currentAnalysis,
        summary: journalUpdate.title ?? currentAnalysis.summary,
        journal: mergedJournal,
      };

      await this.db
        .update(analyses)
        .set({
          analysis: updatedAnalysis,
          summary: journalUpdate.title ?? (currentAnalysis.summary as string | undefined),
        })
        .where(eq(analyses.id, latest.id));
    }
  }

  async findLatestAnalysisId(conversationId: string): Promise<string | null> {
    const [row] = await this.db
      .select({ id: analyses.id })
      .from(analyses)
      .where(eq(analyses.conversationId, conversationId))
      .orderBy(desc(analyses.createdAt))
      .limit(1);

    return row?.id ?? null;
  }

  async findEntitiesByAnalysis(analysisId: string) {
    return this.db
      .select({
        id: entities.id,
        kind: entities.kind,
        name: entities.name,
        normalizedName: entities.normalizedName,
        relation: entities.relation,
        confidence: entities.confidence,
      })
      .from(entities)
      .where(eq(entities.analysisId, analysisId));
  }

  async findItemsByAnalysis(analysisId: string) {
    return this.db
      .select({
        id: items.id,
        type: items.type,
        title: items.title,
        summary: items.summary,
        sourceText: items.sourceText,
        confidence: items.confidence,
        details: items.details,
      })
      .from(items)
      .where(eq(items.analysisId, analysisId));
  }

  async findItemEntityLinks(itemIds: string[]) {
    if (itemIds.length === 0) return [];

    return this.db
      .select({
        itemId: itemEntities.itemId,
        entityId: itemEntities.entityId,
        role: itemEntities.role,
      })
      .from(itemEntities)
      .where(inArray(itemEntities.itemId, itemIds));
  }
}
