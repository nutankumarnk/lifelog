/**
 * Mirror of the backend's response contract.
 *
 * Hand-written on purpose. The console is a client like the future mobile app
 * will be, so it consumes the documented API shape (docs/api.md) rather than
 * importing backend types. If these drift, the contract is being changed
 * without the documentation catching up.
 */

export type Intent =
  | 'LOG'
  | 'PLAN'
  | 'CAPTURE_TASK'
  | 'SET_REMINDER'
  | 'REFLECT'
  | 'ASK'
  | 'CORRECT'
  | 'SMALL_TALK'
  | 'UNKNOWN';

export type ItemType =
  | 'MEMORY'
  | 'PAST_EVENT'
  | 'PRESENT_FACT'
  | 'FUTURE_EVENT'
  | 'TASK'
  | 'REMINDER'
  | 'DECISION'
  | 'FEELING';

export type EntityKind =
  | 'PERSON'
  | 'PLACE'
  | 'ORGANIZATION'
  | 'OBJECT'
  | 'TOPIC'
  | 'EVENT_NAME'
  | 'OTHER';

export interface SourceSpan {
  start: number;
  end: number;
}

export interface Temporal {
  tense: 'PAST' | 'PRESENT' | 'FUTURE' | 'UNSPECIFIED';
  raw: string | null;
  resolved: string | null;
  resolved_end: string | null;
  precision: string;
  recurrence: string | null;
  timezone: string | null;
  confidence: number;
}

export interface Entity {
  id: string;
  kind: EntityKind;
  raw_kind: string | null;
  name: string;
  normalized_name: string;
  aliases: string[];
  relation: string | null;
  attributes: Record<string, unknown>;
  mentions: SourceSpan[];
  confidence: number;
}

export interface Item {
  id: string;
  type: ItemType;
  title: string;
  summary: string;
  source_text: string;
  source_span: SourceSpan | null;
  segment_index: number | null;
  temporal: Temporal;
  entity_ids: string[];
  details: Record<string, unknown>;
  confidence: number;
}

export interface Segment {
  index: number;
  text: string;
  span: SourceSpan;
}

export interface MissingInfo {
  field: string;
  about_item_id: string | null;
  reason: string;
  importance: 'LOW' | 'MEDIUM' | 'HIGH';
}

export interface FollowUp {
  question: string;
  reason: string;
  missing_fields: string[];
  blocking: boolean;
}

export interface Warning {
  code: string;
  message: string;
  detail?: Record<string, unknown>;
}

export interface Analysis {
  schema_version: string;
  intent: Intent;
  intent_confidence: number;
  stance?: string;
  stance_confidence?: number;
  language: string;
  summary: string;
  segments: Segment[];
  entities: Entity[];
  items: Item[];
  emotional_impact?: Array<{
    valence: string;
    intensity: number;
    summary: string;
    inferred: true;
    confidence: number;
  }>;
  gaps?: Array<{ code: string; message: string }>;
  algorithm_confidence?: number;
  reconciliation?: {
    used_ai_teacher: boolean;
    skipped_ai: boolean;
    disagreement_count: number;
    winners: string[];
  };
  missing_information: MissingInfo[];
  follow_up: FollowUp | null;
  warnings: Warning[];
}

export type ActionStatus = 'OPEN' | 'IN_PROGRESS' | 'DONE' | 'CANCELLED';
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

export interface ActionItem {
  id: string;
  kind: 'TASK' | 'REMINDER';
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
  sources: ActionSource[];
  links: ActionLink[];
}

export interface ActionListResponse {
  items: ActionItem[];
  counts: { open: number; done: number; total: number };
}

export interface AnalyzeResponse {
  conversationId: string;
  analysisId: string;
  analysis: Analysis;
  meta: {
    provider: string;
    model: string;
    degraded: boolean;
    persisted: boolean;
    latency_ms: number;
    schema_version: string;
  };
}

export interface ApiError {
  error: {
    code: string;
    message: string;
    details?: Array<{ path: string; message: string }>;
    requestId?: string;
  };
}

export interface HealthResponse {
  status: 'ok' | 'degraded' | 'error';
  uptime_s: number;
  version: string;
  checks: {
    database: 'ok' | 'error' | 'skipped';
    ai_provider: 'ok' | 'degraded' | 'error';
  };
}
