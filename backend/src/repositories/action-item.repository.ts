/**
 * Tasks and reminders — the canonical, de-duplicated list.
 *
 * Tasks and reminders behave differently on purpose:
 *
 *   TASK      the user completes it. Checking it off is a user action.
 *   REMINDER  Lifelog notifies at a time. The user does not tick it off, and
 *             cannot delete it — a reminder they asked for is a promise Lifelog
 *             made. It can only be marked notified, or cancelled explicitly.
 *
 * Restating something is not a new obligation, so writes upsert on the action
 * key and record provenance instead of inserting a second row.
 */
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { actionItemLinks, actionItems, actionItemSources, entities } from '../db/schema.js';
import { buildActionKey } from '../domain/action-key.js';

export type ActionKind = 'TASK' | 'REMINDER';
export type TaskStatus = 'OPEN' | 'IN_PROGRESS' | 'DONE' | 'CANCELLED';
export type ReminderStatus = 'SCHEDULED' | 'NOTIFIED' | 'CANCELLED';

export interface ActionSource {
  conversationId: string;
  sourceText: string;
  conversationText: string;
  provider: string;
  createdAt: string;
}

export interface ActionLink {
  entityId: string;
  name: string;
  kind: string;
  relation: string | null;
  role: string;
}

export interface ActionRecord {
  id: string;
  kind: ActionKind;
  title: string;
  displayText: string;
  status: string;
  priority: string;
  dueAt: string | null;
  temporalRaw: string | null;
  recurrence: string | null;
  occurrences: number;
  firstSeenAt: string;
  lastSeenAt: string;
  completedAt: string | null;
  notifiedAt: string | null;
  /** How this came to exist: every message that asked for it. */
  sources: ActionSource[];
  /** Who and what it is about. */
  links: ActionLink[];
}

export interface RecordActionInput {
  kind: ActionKind;
  title: string;
  displayText: string;
  sourceText: string;
  conversationText: string;
  conversationId: string;
  itemId?: string | null;
  provider: string;
  priority?: string;
  dueAt: Date | null;
  temporalRaw: string | null;
  recurrence: string | null;
  /** Local entity ids resolved to database rows by the caller. */
  entityIds: string[];
  entityNames: string[];
}

export interface RecordActionResult {
  id: string;
  created: boolean;
}

function isoOrNull(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

export class ActionItemRepository {
  constructor(private readonly db: Database) {}

  /**
   * Inserts a task/reminder, or merges into the existing one with the same
   * action key. Always records where this mention came from.
   */
  async record(input: RecordActionInput): Promise<RecordActionResult> {
    const dedupeKey = buildActionKey({
      kind: input.kind,
      text: input.displayText || input.sourceText || input.title,
    });

    const defaultStatus = input.kind === 'REMINDER' ? 'SCHEDULED' : 'OPEN';

    const [row] = await this.db
      .insert(actionItems)
      .values({
        kind: input.kind,
        dedupeKey,
        title: input.title,
        displayText: input.displayText,
        status: defaultStatus,
        priority: input.priority ?? 'NORMAL',
        dueAt: input.dueAt,
        temporalRaw: input.temporalRaw,
        recurrence: input.recurrence,
      })
      .onConflictDoUpdate({
        target: [actionItems.kind, actionItems.dedupeKey],
        set: {
          occurrences: sql`${actionItems.occurrences} + 1`,
          lastSeenAt: new Date(),
          // Restating with a new time reschedules; it does not duplicate.
          dueAt: sql`COALESCE(EXCLUDED.due_at, ${actionItems.dueAt})`,
          temporalRaw: sql`COALESCE(EXCLUDED.temporal_raw, ${actionItems.temporalRaw})`,
          displayText: sql`CASE WHEN length(EXCLUDED.display_text) > length(${actionItems.displayText})
            THEN EXCLUDED.display_text ELSE ${actionItems.displayText} END`,
        },
      })
      .returning({ id: actionItems.id, occurrences: actionItems.occurrences });

    if (!row) throw new Error('action item upsert returned no row');

    await this.db.insert(actionItemSources).values({
      actionItemId: row.id,
      conversationId: input.conversationId,
      itemId: input.itemId ?? null,
      sourceText: input.sourceText,
      conversationText: input.conversationText,
      provider: input.provider,
    });

    if (input.entityIds.length > 0) {
      await this.db
        .insert(actionItemLinks)
        .values(
          input.entityIds.map((entityId) => ({
            actionItemId: row.id,
            entityId,
            role: 'about',
          })),
        )
        .onConflictDoNothing();
    }

    return { id: row.id, created: row.occurrences === 1 };
  }

  /** Lists one kind, newest activity first, with provenance and links. */
  async list(kind: ActionKind, options: { limit?: number } = {}): Promise<ActionRecord[]> {
    const rows = await this.db
      .select()
      .from(actionItems)
      .where(eq(actionItems.kind, kind))
      .orderBy(desc(actionItems.lastSeenAt))
      .limit(Math.min(options.limit ?? 100, 200));

    if (rows.length === 0) return [];

    const ids = rows.map((row) => row.id);

    const sources = await this.db
      .select()
      .from(actionItemSources)
      .where(inArray(actionItemSources.actionItemId, ids))
      .orderBy(desc(actionItemSources.createdAt));

    const links = await this.db
      .select({
        actionItemId: actionItemLinks.actionItemId,
        entityId: actionItemLinks.entityId,
        role: actionItemLinks.role,
        name: entities.name,
        kind: entities.kind,
        relation: entities.relation,
      })
      .from(actionItemLinks)
      .innerJoin(entities, eq(entities.id, actionItemLinks.entityId))
      .where(inArray(actionItemLinks.actionItemId, ids));

    return rows.map((row) => ({
      id: row.id,
      kind: row.kind as ActionKind,
      title: row.title,
      displayText: row.displayText,
      status: row.status,
      priority: row.priority,
      dueAt: isoOrNull(row.dueAt),
      temporalRaw: row.temporalRaw,
      recurrence: row.recurrence,
      occurrences: row.occurrences,
      firstSeenAt: row.firstSeenAt.toISOString(),
      lastSeenAt: row.lastSeenAt.toISOString(),
      completedAt: isoOrNull(row.completedAt),
      notifiedAt: isoOrNull(row.notifiedAt),
      sources: sources
        .filter((source) => source.actionItemId === row.id)
        .map((source) => ({
          conversationId: source.conversationId,
          sourceText: source.sourceText,
          conversationText: source.conversationText,
          provider: source.provider,
          createdAt: source.createdAt.toISOString(),
        })),
      links: links
        .filter((link) => link.actionItemId === row.id)
        // The same person can be linked through several analyses.
        .filter(
          (link, index, all) => all.findIndex((other) => other.name === link.name) === index,
        )
        .map((link) => ({
          entityId: link.entityId,
          name: link.name,
          kind: link.kind,
          relation: link.relation,
          role: link.role,
        })),
    }));
  }

  /** Completing or reopening a task. Tasks only — reminders are not tickable. */
  async setTaskStatus(id: string, status: TaskStatus): Promise<boolean> {
    const [row] = await this.db
      .update(actionItems)
      .set({
        status,
        completedAt: status === 'DONE' ? new Date() : null,
      })
      .where(and(eq(actionItems.id, id), eq(actionItems.kind, 'TASK')))
      .returning({ id: actionItems.id });

    return Boolean(row);
  }

  /**
   * Marks a reminder notified. A reminder cannot be deleted or ticked off by
   * the user — Lifelog owns its lifecycle once the user asked for it.
   */
  async markReminderNotified(id: string): Promise<boolean> {
    const [row] = await this.db
      .update(actionItems)
      .set({ status: 'NOTIFIED', notifiedAt: new Date() })
      .where(and(eq(actionItems.id, id), eq(actionItems.kind, 'REMINDER')))
      .returning({ id: actionItems.id });

    return Boolean(row);
  }
}
