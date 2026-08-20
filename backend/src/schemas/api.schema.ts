/**
 * Request/response schemas for the public HTTP API.
 *
 * The future mobile client will consume exactly these shapes, so treat changes
 * here as breaking until Phase 8 introduces versioned negotiation.
 * Documented in docs/api.md.
 */
import { z } from 'zod';
import { AnalysisSchema } from './analysis.schema.js';

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
