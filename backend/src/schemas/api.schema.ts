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
