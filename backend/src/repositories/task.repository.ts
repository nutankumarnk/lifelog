/**
 * Task and reminder queries.
 *
 * Reads the action items Lifelog has extracted across conversations, and
 * records completion. Items themselves are never rewritten — completion is a
 * status change on the extracted item, not an edit to what the user said.
 */
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { items } from '../db/schema.js';

export type ActionStatus = 'OPEN' | 'IN_PROGRESS' | 'DONE' | 'CANCELLED';

export interface ActionItemRow {
  id: string;
  conversationId: string;
  type: 'TASK' | 'REMINDER';
  title: string;
  summary: string;
  displayText: string | null;
  sourceText: string;
  dueAt: string | null;
  temporalRaw: string | null;
  status: ActionStatus;
  priority: string | null;
  completedAt: string | null;
  createdAt: string;
}

interface RawItemRow {
  id: string;
  conversationId: string;
  type: string;
  title: string;
  summary: string;
  sourceText: string;
  occurredAt: Date | null;
  temporalRaw: string | null;
  details: Record<string, unknown>;
  createdAt: Date;
}

function toActionItem(row: RawItemRow): ActionItemRow {
  const details = row.details ?? {};
  const status = (details.status as ActionStatus) ?? 'OPEN';
  return {
    id: row.id,
    conversationId: row.conversationId,
    type: row.type === 'REMINDER' ? 'REMINDER' : 'TASK',
    title: row.title,
    summary: row.summary,
    displayText: typeof details.display_text === 'string' ? details.display_text : null,
    sourceText: row.sourceText,
    dueAt: row.occurredAt ? row.occurredAt.toISOString() : null,
    temporalRaw: row.temporalRaw,
    status,
    priority: typeof details.priority === 'string' ? details.priority : null,
    completedAt: typeof details.completed_at === 'string' ? details.completed_at : null,
    createdAt: row.createdAt.toISOString(),
  };
}

export class TaskRepository {
  constructor(private readonly db: Database) {}

  /** Lists tasks and reminders, newest first. Optionally filtered by status. */
  async list(options: { status?: ActionStatus; limit?: number } = {}): Promise<ActionItemRow[]> {
    const rows = await this.db
      .select({
        id: items.id,
        conversationId: items.conversationId,
        type: items.type,
        title: items.title,
        summary: items.summary,
        sourceText: items.sourceText,
        occurredAt: items.occurredAt,
        temporalRaw: items.temporalRaw,
        details: items.details,
        createdAt: items.createdAt,
      })
      .from(items)
      .where(inArray(items.type, ['TASK', 'REMINDER']))
      .orderBy(desc(items.createdAt))
      .limit(Math.min(options.limit ?? 100, 200));

    const mapped = rows.map((row) => toActionItem(row as RawItemRow));
    return options.status ? mapped.filter((row) => row.status === options.status) : mapped;
  }

  /** Sets the status of one action item. Returns null when it does not exist. */
  async setStatus(
    id: string,
    status: ActionStatus,
    now: Date = new Date(),
  ): Promise<ActionItemRow | null> {
    const completedAt = status === 'DONE' ? now.toISOString() : null;

    const [updated] = await this.db
      .update(items)
      .set({
        details: sql`${items.details} || ${JSON.stringify({
          status,
          completed_at: completedAt,
        })}::jsonb`,
      })
      .where(and(eq(items.id, id), inArray(items.type, ['TASK', 'REMINDER'])))
      .returning({
        id: items.id,
        conversationId: items.conversationId,
        type: items.type,
        title: items.title,
        summary: items.summary,
        sourceText: items.sourceText,
        occurredAt: items.occurredAt,
        temporalRaw: items.temporalRaw,
        details: items.details,
        createdAt: items.createdAt,
      });

    return updated ? toActionItem(updated as RawItemRow) : null;
  }
}
