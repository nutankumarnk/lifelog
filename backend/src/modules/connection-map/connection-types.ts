/**
 * Connection Map — Type Definitions (V2)
 *
 * Single source of truth for:
 *   - Allowed Connection Map object types (spec §2)
 *   - Forbidden object types — must never become graph nodes (spec §3)
 *   - The minimum confidence threshold for relationship acceptance
 *   - The LLM extraction output contract (spec §17)
 *
 * Object types per spec §2:
 *   person | place | project | organization | event | object | other
 *
 * Internal names (stored in DB, used in code):
 *   "object" → "physical_object"
 *   "other"  → "other_entity"
 *
 * Both public names and internal names are accepted by the validator.
 * Never mutate the sets below at runtime.
 */

// ---------------------------------------------------------------------------
// Allowed object types — spec §2
// ---------------------------------------------------------------------------

/**
 * The seven Connection Map object types per spec §2.
 *
 * Public names (as the spec spells them):
 *   person, place, project, organization, event, object, other
 *
 * Internal/DB names (used for storage and matrix lookup):
 *   person, place, project, organization, event, physical_object, other_entity
 *
 * Aliases are resolved in connection-validator.ts → validateObjectType().
 */
export const CONNECTION_MAP_OBJECT_TYPES = [
  'person',
  'place',
  'project',
  'organization',
  'event',
  'physical_object',   // internal name for spec "object"
  'other_entity',      // internal name for spec "other"
] as const;

export type ConnectionMapObjectType = (typeof CONNECTION_MAP_OBJECT_TYPES)[number];

/** O(1) membership test for internal type names. */
export const CONNECTION_MAP_OBJECT_TYPE_SET = new Set<string>(CONNECTION_MAP_OBJECT_TYPES);

/**
 * Public spec names that map to internal names.
 * Used in validateObjectType() to accept both spellings.
 */
export const OBJECT_TYPE_ALIASES: Record<string, ConnectionMapObjectType> = {
  object: 'physical_object',
  other: 'other_entity',
};

// ---------------------------------------------------------------------------
// Forbidden object types — spec §3
// ---------------------------------------------------------------------------

/**
 * These must NEVER become Connection Map graph nodes.
 *
 * Per spec §3:
 *   task, reminder, decision, feeling, emotion, memory, note,
 *   conversation, notification, alarm, summary, goal, intention
 *
 * They belong to other parts of the system (task tracker, memory layer, etc.)
 *
 * Rule: if a candidate object's type (after normalisation) matches any entry
 * here, it must be silently dropped and logged as a warning.
 */
export const FORBIDDEN_OBJECT_TYPES = new Set<string>([
  // Spec §3 — explicit list
  'task',
  'reminder',
  'decision',
  'feeling',
  'emotion',
  'memory',
  'note',
  'conversation',
  'notification',
  'alarm',
  'summary',
  'goal',
  'intention',
  // Legacy types produced by the V1 connection builder
  'fact',
  'topic',
  'habit',
]);

// ---------------------------------------------------------------------------
// Confidence threshold
// ---------------------------------------------------------------------------

/**
 * The minimum relationship confidence required for a relationship to be
 * accepted into the Connection Map.
 *
 * Spec §20: below 0.50 → do not create the relationship.
 * Relationships below this threshold are discarded before reaching the
 * Connection Matrix validator.
 */
export const MIN_RELATIONSHIP_CONFIDENCE = 0.50;

// ---------------------------------------------------------------------------
// LLM extraction output contract — spec §17
// ---------------------------------------------------------------------------

/**
 * The shape the LLM returns when processing a conversation for
 * Connection Map extraction.
 *
 * The LLM uses temporary IDs (e.g. "obj_1") which the backend resolves
 * to real database IDs only after validation passes.
 *
 * LLM relationship format per spec §17:
 *   { "source": "Arun", "target": "Lifelog", "relationship": "works_on" }
 *
 * Here we use temporary_id references instead of names for precision.
 */
export interface LlmExtractedObject {
  /** Temporary id, unique within this batch — used by relationships. */
  temporary_id: string;
  /** One of the 7 Connection Map types (public or internal spelling). */
  type: string;
  /** The entity name as the user stated it. */
  name: string;
  /** Optional free-form attributes (role, location, etc.) */
  attributes?: Record<string, unknown>;
}

export interface LlmExtractedRelationship {
  source_temporary_id: string;
  target_temporary_id: string;
  relationship_type: string;
  /** 0–1. Below MIN_RELATIONSHIP_CONFIDENCE the relationship is rejected. */
  confidence: number;
  /** Verbatim user text that evidences this relationship. */
  evidence: string;
}

export interface LlmExtractionResult {
  objects: LlmExtractedObject[];
  relationships: LlmExtractedRelationship[];
}

// ---------------------------------------------------------------------------
// Validated output (post-matrix check)
// ---------------------------------------------------------------------------

export interface ValidatedConnectionObject {
  temporaryId: string;
  type: ConnectionMapObjectType;
  name: string;
  attributes: Record<string, unknown>;
}

export interface ValidatedConnectionRelationship {
  sourceTemporaryId: string;
  targetTemporaryId: string;
  relationshipType: string;
  confidence: number;
  evidence: string;
}

export interface ConnectionValidationResult {
  objects: ValidatedConnectionObject[];
  relationships: ValidatedConnectionRelationship[];
  /** Non-fatal notes explaining what was dropped and why. */
  warnings: string[];
}
