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
  journal?: JournalEntry;
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
    usage: {
      prompt_tokens: number;
      completion_tokens: number;
      total_tokens: number;
      source: 'provider' | 'estimated';
    };
    ai_exchange?: {
      provider: string;
      model: string;
      request: unknown;
      response: unknown;
    };
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

/** A personalized journal & diary entry generated with grammar correction and mood detection */
export interface JournalEntry {
  title: string;
  polished_entry: string;
  mood: string;
  highlights: string[];
}

/** A single entry returned by GET /api/v1/notes */
export interface NoteEntry {
  id: string;
  original_text: string;
  created_at: string;
  updated_at: string;
  occurred_at?: string;
  timezone?: string | null;
  language?: string | null;
  source: string;
  processing_status: string;
  journal?: JournalEntry;
}

/** Pagination metadata */
export interface NotePagination {
  page: number;
  limit: number;
  total: number;
  total_pages: number;
}

/** Response shape from GET /api/v1/notes */
export interface NoteListResponse {
  notes: NoteEntry[];
  pagination: NotePagination;
}

export interface ExtractedObject {
  id: string;
  type: string;
  name: string;
  kind?: string;
  summary?: string;
  source_text?: string;
  confidence: number;
  details?: Record<string, unknown>;
}

export interface NoteRelationship {
  source_object: string;
  target_object: string;
  relationship_type: string;
}

export interface NoteDetail extends NoteEntry {
  occurred_at: string;
  timezone: string | null;
  language: string | null;
  objects: ExtractedObject[];
  relationships: NoteRelationship[];
}

export interface AiTraceMessage {
  role: string;
  content: string;
}

export interface AiTraceAttempt {
  provider: string;
  model: string;
  attempt: number;
  status: string;
  latency_ms: number;
  error_kind?: string;
  error_message?: string;
}

export interface AiTrace {
  provider: string;
  model: string;
  request: {
    kind: string;
    messages: AiTraceMessage[];
    [key: string]: unknown;
  };
  response: {
    raw_text: string;
    parsed?: unknown;
    [key: string]: unknown;
  };
  attempts: AiTraceAttempt[];
}

export interface MemoryObject {
  id: string;
  type: string;
  name: string;
  attributes: Record<string, unknown>;
  mention_count: number;
  first_seen_at: string;
  last_seen_at: string;
  created_at: string;
  updated_at: string;
}

export interface MemoryObjectRelationship {
  id: string;
  source_id?: string;
  target_id?: string;
  source_object_id?: string;
  target_object_id?: string;
  relationship_type: string;
  confidence: number;
  source_conversation_id?: string;
  attributes?: Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
}

export interface MemoryObjectDetail extends MemoryObject {
  relationships: MemoryObjectRelationship[];
  origins?: Array<{
    id: string;
    conversation_id: string;
    created_at: string;
    source_text: string;
    conversation_text: string;
  }>;
}

export interface MemoryGraphData {
  objects: MemoryObject[];
  relationships: Array<Required<Pick<MemoryObjectRelationship,
    'id' | 'source_object_id' | 'target_object_id' | 'relationship_type' | 'confidence'
  >> & MemoryObjectRelationship>;
}
