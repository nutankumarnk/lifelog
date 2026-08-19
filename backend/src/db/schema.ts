/**
 * Lifelog relational schema (Drizzle).
 *
 * Two ideas govern this schema:
 *
 *   1. `conversations.raw_text` is the source of truth. It is written first,
 *      never rewritten, and never derived from anything. If every extraction
 *      table were dropped, no user data would be lost.
 *
 *   2. Everything else is an *interpretation*. Interpretations are versioned by
 *      analysis, so re-analysing a conversation with a better model adds a row
 *      rather than destroying the previous reading.
 *
 * Document every change here in docs/data-model.md.
 */
import { relations, sql } from 'drizzle-orm';
import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

// ---------------------------------------------------------------------------
// conversations — the immutable record of what the user actually said.
// ---------------------------------------------------------------------------

export const conversations = pgTable(
  'conversations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /**
     * Phase 1 has no authentication, so every row belongs to a fixed local
     * user. The column exists now so Phase 8 can add real users without a
     * destructive migration. See docs/decision.md.
     */
    userId: uuid('user_id'),
    rawText: text('raw_text').notNull(),
    charCount: integer('char_count').notNull(),
    /** Detected language tag, or "mixed" for code-switched input. */
    language: varchar('language', { length: 32 }),
    /** Client wall clock used to resolve relative dates like "yesterday". */
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    timezone: varchar('timezone', { length: 64 }),
    source: varchar('source', { length: 32 }).notNull().default('api'),
    clientMeta: jsonb('client_meta').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (table) => [
    index('conversations_created_at_idx').on(table.createdAt),
    index('conversations_user_created_idx').on(table.userId, table.createdAt),
  ],
);

// ---------------------------------------------------------------------------
// analyses — one interpretation of one conversation.
// ---------------------------------------------------------------------------

export const analyses = pgTable(
  'analyses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    schemaVersion: varchar('schema_version', { length: 16 }).notNull(),
    intent: varchar('intent', { length: 32 }).notNull(),
    intentConfidence: doublePrecision('intent_confidence').notNull().default(0.5),
    summary: text('summary').notNull().default(''),
    /** Which adapter produced this reading: openrouter | local | mock. */
    provider: varchar('provider', { length: 32 }).notNull(),
    model: varchar('model', { length: 128 }).notNull(),
    /** True when the primary provider failed and a fallback answered. */
    degraded: boolean('degraded').notNull().default(false),
    latencyMs: integer('latency_ms').notNull().default(0),
    /**
     * The validated analysis, stored whole. Reading one conversation back needs
     * a single row; the child tables exist for querying across conversations.
     */
    analysis: jsonb('analysis').$type<Record<string, unknown>>().notNull(),
    warnings: jsonb('warnings').$type<unknown[]>().notNull().default([]),
    createdAt: createdAt(),
  },
  (table) => [
    index('analyses_conversation_idx').on(table.conversationId),
    index('analyses_intent_idx').on(table.intent),
    index('analyses_created_at_idx').on(table.createdAt),
  ],
);

// ---------------------------------------------------------------------------
// segments — the conversation broken into meaningful pieces.
// ---------------------------------------------------------------------------

export const segments = pgTable(
  'segments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    analysisId: uuid('analysis_id')
      .notNull()
      .references(() => analyses.id, { onDelete: 'cascade' }),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    text: text('text').notNull(),
    spanStart: integer('span_start').notNull(),
    spanEnd: integer('span_end').notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('segments_analysis_position_uidx').on(table.analysisId, table.position),
    index('segments_conversation_idx').on(table.conversationId),
  ],
);

// ---------------------------------------------------------------------------
// entities — people, places, organisations, objects, topics and unknowns.
// ---------------------------------------------------------------------------

export const entities = pgTable(
  'entities',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    analysisId: uuid('analysis_id')
      .notNull()
      .references(() => analyses.id, { onDelete: 'cascade' }),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    /** Stable id within the analysis payload, e.g. "e1". Used to join items. */
    localId: varchar('local_id', { length: 32 }).notNull(),
    kind: varchar('kind', { length: 32 }).notNull(),
    /**
     * The model's original label when `kind` had to be widened to OTHER.
     * Keeping it means a custom entity type is never silently destroyed.
     */
    rawKind: varchar('raw_kind', { length: 64 }),
    name: text('name').notNull(),
    /** Case/punctuation-folded name. Phase 5 will resolve identity across rows. */
    normalizedName: text('normalized_name').notNull(),
    relation: varchar('relation', { length: 64 }),
    aliases: jsonb('aliases').$type<string[]>().notNull().default([]),
    attributes: jsonb('attributes').$type<Record<string, unknown>>().notNull().default({}),
    mentions: jsonb('mentions').$type<unknown[]>().notNull().default([]),
    confidence: doublePrecision('confidence').notNull().default(0.5),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('entities_analysis_local_uidx').on(table.analysisId, table.localId),
    index('entities_normalized_name_idx').on(table.normalizedName),
    index('entities_kind_idx').on(table.kind),
    index('entities_conversation_idx').on(table.conversationId),
  ],
);

// ---------------------------------------------------------------------------
// items — the extracted units of life information.
// ---------------------------------------------------------------------------

export const items = pgTable(
  'items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    analysisId: uuid('analysis_id')
      .notNull()
      .references(() => analyses.id, { onDelete: 'cascade' }),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    localId: varchar('local_id', { length: 32 }).notNull(),
    type: varchar('type', { length: 32 }).notNull(),
    title: text('title').notNull(),
    summary: text('summary').notNull().default(''),
    /** Verbatim source text. Proof the item is grounded in the conversation. */
    sourceText: text('source_text').notNull().default(''),
    spanStart: integer('span_start'),
    spanEnd: integer('span_end'),
    segmentPosition: integer('segment_position'),
    tense: varchar('tense', { length: 16 }).notNull().default('UNSPECIFIED'),
    /** What the user literally said: "yesterday", "next Friday". */
    temporalRaw: text('temporal_raw'),
    /** Lifelog's resolution of that phrase. Nullable — resolution can fail. */
    occurredAt: timestamp('occurred_at', { withTimezone: true }),
    occurredEndAt: timestamp('occurred_end_at', { withTimezone: true }),
    temporalPrecision: varchar('temporal_precision', { length: 16 }).notNull().default('NONE'),
    recurrence: text('recurrence'),
    details: jsonb('details').$type<Record<string, unknown>>().notNull().default({}),
    confidence: doublePrecision('confidence').notNull().default(0.5),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('items_analysis_local_uidx').on(table.analysisId, table.localId),
    index('items_type_idx').on(table.type),
    index('items_conversation_idx').on(table.conversationId),
    index('items_occurred_at_idx').on(table.occurredAt),
    index('items_type_occurred_idx').on(table.type, table.occurredAt),
  ],
);

// ---------------------------------------------------------------------------
// item_entities — which entities take part in which item.
// ---------------------------------------------------------------------------

export const itemEntities = pgTable(
  'item_entities',
  {
    itemId: uuid('item_id')
      .notNull()
      .references(() => items.id, { onDelete: 'cascade' }),
    entityId: uuid('entity_id')
      .notNull()
      .references(() => entities.id, { onDelete: 'cascade' }),
    /** Reserved for Phase 5 relationship typing (participant, location, ...). */
    role: varchar('role', { length: 32 }).notNull().default('mentioned'),
  },
  (table) => [
    primaryKey({ columns: [table.itemId, table.entityId] }),
    index('item_entities_entity_idx').on(table.entityId),
  ],
);

// ---------------------------------------------------------------------------
// follow_ups — clarifying questions Lifelog decided to ask.
// ---------------------------------------------------------------------------

export const followUps = pgTable(
  'follow_ups',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    analysisId: uuid('analysis_id')
      .notNull()
      .references(() => analyses.id, { onDelete: 'cascade' }),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    question: text('question').notNull(),
    reason: text('reason').notNull().default(''),
    missingFields: jsonb('missing_fields').$type<string[]>().notNull().default([]),
    blocking: boolean('blocking').notNull().default(false),
    /** Set when a later phase feeds the user's answer back in. */
    answeredAt: timestamp('answered_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (table) => [index('follow_ups_conversation_idx').on(table.conversationId)],
);

// ---------------------------------------------------------------------------
// ai_invocations — observability for every model call.
// ---------------------------------------------------------------------------

export const aiInvocations = pgTable(
  'ai_invocations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    conversationId: uuid('conversation_id').references(() => conversations.id, {
      onDelete: 'cascade',
    }),
    provider: varchar('provider', { length: 32 }).notNull(),
    model: varchar('model', { length: 128 }).notNull(),
    status: varchar('status', { length: 16 }).notNull(),
    attempt: integer('attempt').notNull().default(1),
    latencyMs: integer('latency_ms').notNull().default(0),
    promptTokens: integer('prompt_tokens'),
    completionTokens: integer('completion_tokens'),
    /** Error class only. Never the prompt, never the key, never the response. */
    errorCode: varchar('error_code', { length: 64 }),
    createdAt: createdAt(),
  },
  (table) => [
    index('ai_invocations_created_idx').on(table.createdAt),
    index('ai_invocations_status_idx').on(table.status),
  ],
);

// ---------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------

export const conversationsRelations = relations(conversations, ({ many }) => ({
  analyses: many(analyses),
  items: many(items),
  entities: many(entities),
}));

export const analysesRelations = relations(analyses, ({ one, many }) => ({
  conversation: one(conversations, {
    fields: [analyses.conversationId],
    references: [conversations.id],
  }),
  items: many(items),
  entities: many(entities),
  segments: many(segments),
  followUps: many(followUps),
}));

export const itemsRelations = relations(items, ({ one, many }) => ({
  analysis: one(analyses, { fields: [items.analysisId], references: [analyses.id] }),
  conversation: one(conversations, {
    fields: [items.conversationId],
    references: [conversations.id],
  }),
  itemEntities: many(itemEntities),
}));

export const entitiesRelations = relations(entities, ({ one, many }) => ({
  analysis: one(analyses, { fields: [entities.analysisId], references: [analyses.id] }),
  itemEntities: many(itemEntities),
}));

export const itemEntitiesRelations = relations(itemEntities, ({ one }) => ({
  item: one(items, { fields: [itemEntities.itemId], references: [items.id] }),
  entity: one(entities, { fields: [itemEntities.entityId], references: [entities.id] }),
}));

/** Truncates every table. Test-support only; never call from application code. */
export const TRUNCATE_ALL = sql`TRUNCATE TABLE
  item_entities, items, entities, segments, follow_ups, ai_invocations, analyses, conversations
  RESTART IDENTITY CASCADE`;
