/**
 * Request/response schemas for the public HTTP API.
 *
 * The future mobile client will consume exactly these shapes, so treat changes
 * here as breaking until Phase 8 introduces versioned negotiation.
 * Documented in docs/api.md.
 */
import { z } from 'zod';
import { AnalysisSchema, JournalEntrySchema } from './analysis.schema.js';

/** Upper bound also enforced by config; this is the hard schema-level ceiling. */
export const MAX_TEXT_LENGTH = 20_000;

export const AnalyzeRequestSchema = z.object({
  text: z
    .string({ required_error: 'text is required', invalid_type_error: 'text must be a string' })
    .min(1, 'text must not be empty')
    .max(MAX_TEXT_LENGTH, `text must be at most ${MAX_TEXT_LENGTH} characters`)
    .refine((value) => value.trim().length > 0, 'text must not be only whitespace'),
  /**
   * Client-supplied wall clock, used to resolve "yesterday" and "next Friday".
   * Falls back to server time when absent.
   */
  occurred_at: z.string().datetime({ offset: true }).optional(),
  /** IANA timezone, e.g. "Asia/Kolkata". Used for temporal resolution only. */
  timezone: z.string().max(64).optional(),
  /** Input channel: api | text | voice | import */
  source: z.string().max(32).optional(),
  /** Free-form client metadata. Never trusted, never used for authorization. */
  client: z
    .object({
      app: z.string().max(64).optional(),
      version: z.string().max(32).optional(),
      platform: z.string().max(32).optional(),
    })
    .optional(),
});
export type AnalyzeRequest = z.infer<typeof AnalyzeRequestSchema>;

export const TokenUsageSchema = z.object({
  prompt_tokens: z.number().int().min(0),
  completion_tokens: z.number().int().min(0),
  total_tokens: z.number().int().min(0),
  /** `provider` = host-reported; `estimated` = length-based approximation. */
  source: z.enum(['provider', 'estimated']),
});
export type TokenUsage = z.infer<typeof TokenUsageSchema>;

export const AiExchangeSchema = z.object({
  provider: z.string(),
  model: z.string(),
  /** Exact HTTP body sent to the provider. Authentication headers are excluded. */
  request: z.unknown(),
  /** Exact successful JSON body returned by the provider. */
  response: z.unknown(),
});

export const AnalyzeResponseSchema = z.object({
  conversationId: z.string().uuid(),
  analysisId: z.string().uuid(),
  analysis: AnalysisSchema,
  meta: z.object({
    provider: z.string(),
    model: z.string(),
    degraded: z.boolean(),
    persisted: z.boolean(),
    latency_ms: z.number().int().min(0),
    schema_version: z.string(),
    usage: TokenUsageSchema,
    /** Present only when explicitly enabled for local development. */
    ai_exchange: AiExchangeSchema.optional(),
  }),
});
export type AnalyzeResponse = z.infer<typeof AnalyzeResponseSchema>;

export const HealthResponseSchema = z.object({
  status: z.enum(['ok', 'degraded', 'error']),
  uptime_s: z.number(),
  version: z.string(),
  checks: z.object({
    database: z.enum(['ok', 'error', 'skipped']),
    ai_provider: z.enum(['ok', 'degraded', 'error']),
  }),
});
export type HealthResponse = z.infer<typeof HealthResponseSchema>;

export const ActionStatusEnum = z.enum(['OPEN', 'IN_PROGRESS', 'DONE', 'CANCELLED']);
export const TaskStatusEnum = z.enum(['OPEN', 'IN_PROGRESS', 'DONE', 'CANCELLED']);
export const ReminderStatusEnum = z.enum(['SCHEDULED', 'NOTIFIED', 'CANCELLED']);

export const ActionSourceSchema = z.object({
  conversationId: z.string().uuid(),
  sourceText: z.string(),
  conversationText: z.string(),
  provider: z.string(),
  createdAt: z.string(),
});

export const ActionLinkSchema = z.object({
  entityId: z.string().uuid(),
  name: z.string(),
  kind: z.string(),
  relation: z.string().nullable(),
  role: z.string(),
});

export const ActionItemSchema = z.object({
  id: z.string().uuid(),
  kind: z.enum(['TASK', 'REMINDER']),
  title: z.string(),
  displayText: z.string(),
  status: z.string(),
  priority: z.string(),
  dueAt: z.string().nullable(),
  temporalRaw: z.string().nullable(),
  recurrence: z.string().nullable(),
  /** How many times the user has asked for this. */
  occurrences: z.number().int().min(1),
  firstSeenAt: z.string(),
  lastSeenAt: z.string(),
  completedAt: z.string().nullable(),
  notifiedAt: z.string().nullable(),
  sources: z.array(ActionSourceSchema),
  links: z.array(ActionLinkSchema),
});
export type ActionItem = z.infer<typeof ActionItemSchema>;

export const ActionListResponseSchema = z.object({
  items: z.array(ActionItemSchema),
  counts: z.object({
    open: z.number().int().min(0),
    done: z.number().int().min(0),
    total: z.number().int().min(0),
  }),
});
export type ActionListResponse = z.infer<typeof ActionListResponseSchema>;

export const UpdateTaskRequestSchema = z.object({
  status: TaskStatusEnum,
});
export type UpdateTaskRequest = z.infer<typeof UpdateTaskRequestSchema>;

export const UpdateReminderRequestSchema = z.object({
  /** Reminders are never deleted or ticked off; Lifelog owns their lifecycle. */
  status: z.enum(['NOTIFIED', 'CANCELLED']),
});
export type UpdateReminderRequest = z.infer<typeof UpdateReminderRequestSchema>;

/** The one and only error envelope. See docs/error-handling.md. */
export const ErrorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
    requestId: z.string().optional(),
  }),
});
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;

// ---------------------------------------------------------------------------
// Notes & Personal Journal API
// ---------------------------------------------------------------------------

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export const NoteListQuerySchema = z.object({
  /** Start of date range filter (inclusive), YYYY-MM-DD. */
  from: z.string().regex(DATE_REGEX, 'from must be YYYY-MM-DD').optional(),
  /** End of date range filter (inclusive), YYYY-MM-DD. */
  to: z.string().regex(DATE_REGEX, 'to must be YYYY-MM-DD').optional(),
  /** Filter by input source: 'api', 'text', 'voice', 'import'. */
  source: z.string().max(32).optional(),
  /** Substring search across note text. */
  search: z.string().max(200).optional(),
  /** Page number, 1-indexed. */
  page: z.coerce.number().int().min(1).default(1),
  /** Results per page. */
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type NoteListQuery = z.infer<typeof NoteListQuerySchema>;

/** A note/journal entry in list responses. */
export const NoteSchema = z.object({
  id: z.string().uuid(),
  original_text: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
  source: z.string(),
  processing_status: z.string(),
  occurred_at: z.string().optional(),
  timezone: z.string().nullable().optional(),
  language: z.string().nullable().optional(),
  journal: JournalEntrySchema.optional(),
});
export type Note = z.infer<typeof NoteSchema>;

/** Paginated list response. */
export const NoteListResponseSchema = z.object({
  notes: z.array(NoteSchema),
  pagination: z.object({
    page: z.number().int().min(1),
    limit: z.number().int().min(1),
    total: z.number().int().min(0),
    total_pages: z.number().int().min(0),
  }),
});
export type NoteListResponse = z.infer<typeof NoteListResponseSchema>;

/** An extracted object (entity or item) traced back to its origin note. */
export const ExtractedObjectSchema = z.object({
  id: z.string(),
  type: z.string(),
  name: z.string(),
  kind: z.string().optional(),
  summary: z.string().optional(),
  source_text: z.string().optional(),
  confidence: z.number(),
  details: z.record(z.unknown()).optional(),
});
export type ExtractedObject = z.infer<typeof ExtractedObjectSchema>;

/** A relationship between two extracted objects. */
export const RelationshipSchema = z.object({
  source_object: z.string(),
  target_object: z.string(),
  relationship_type: z.string(),
});
export type Relationship = z.infer<typeof RelationshipSchema>;

/** Full note detail with extracted objects and relationships. */
export const NoteDetailSchema = NoteSchema.extend({
  occurred_at: z.string(),
  timezone: z.string().nullable(),
  language: z.string().nullable(),
  objects: z.array(ExtractedObjectSchema),
  relationships: z.array(RelationshipSchema),
});
export type NoteDetail = z.infer<typeof NoteDetailSchema>;

/** Request body for editing a note's journal entry. */
export const UpdateNoteRequestSchema = z.object({
  title: z.string().max(200).optional(),
  polished_entry: z.string().max(10_000).optional(),
  mood: z.string().max(64).optional(),
  highlights: z.array(z.string().max(300)).optional(),
  original_text: z.string().max(MAX_TEXT_LENGTH).optional(),
});
export type UpdateNoteRequest = z.infer<typeof UpdateNoteRequestSchema>;

// ---------------------------------------------------------------------------
// Memory API — Phase 2 memory objects and connections.
// ---------------------------------------------------------------------------

export const MemoryObjectListQuerySchema = z.object({
  type: z.string().max(64).optional(),
  search: z.string().max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type MemoryObjectListQuery = z.infer<typeof MemoryObjectListQuerySchema>;

export const MemoryObjectSchema = z.object({
  id: z.string().uuid(),
  type: z.string(),
  name: z.string(),
  attributes: z.record(z.unknown()),
  mention_count: z.number().int().min(0),
  first_seen_at: z.string(),
  last_seen_at: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type MemoryObject = z.infer<typeof MemoryObjectSchema>;

export const MemoryObjectListResponseSchema = z.object({
  objects: z.array(MemoryObjectSchema),
  pagination: z.object({
    page: z.number().int().min(1),
    limit: z.number().int().min(1),
    total: z.number().int().min(0),
    total_pages: z.number().int().min(0),
  }),
});
export type MemoryObjectListResponse = z.infer<typeof MemoryObjectListResponseSchema>;

export const ObjectOriginSchema = z.object({
  id: z.string().uuid(),
  conversation_id: z.string().uuid(),
  origin_type: z.string(),
  confidence: z.number(),
  created_at: z.string(),
});

export const ObjectRelationshipApiSchema = z.object({
  id: z.string().uuid(),
  source_object_id: z.string().uuid(),
  target_object_id: z.string().uuid(),
  relationship_type: z.string(),
  confidence: z.number(),
  source_conversation_id: z.string().uuid(),
  attributes: z.record(z.unknown()),
  created_at: z.string(),
  updated_at: z.string(),
});
export type ObjectRelationshipApi = z.infer<typeof ObjectRelationshipApiSchema>;

export const MemoryObjectDetailSchema = MemoryObjectSchema.extend({
  origins: z.array(ObjectOriginSchema),
  relationships: z.array(ObjectRelationshipApiSchema),
});
export type MemoryObjectDetail = z.infer<typeof MemoryObjectDetailSchema>;

export const ConversationObjectsSchema = z.object({
  conversation_id: z.string().uuid(),
  objects: z.array(MemoryObjectSchema),
  relationships: z.array(ObjectRelationshipApiSchema),
});
export type ConversationObjects = z.infer<typeof ConversationObjectsSchema>;
