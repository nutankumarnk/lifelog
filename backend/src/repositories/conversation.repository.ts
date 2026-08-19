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
import { eq } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { conversations } from '../db/schema.js';

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
    await this.db.update(conversations).set({ language }).where(eq(conversations.id, id));
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
}
