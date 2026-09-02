/**
 * Connection Validator (V2)
 *
 * Stateless functions that validate objects and relationships against:
 *   1. The forbidden-type list (tasks, reminders, decisions, feelings, etc.) — spec §3
 *   2. The Connection Matrix (allowed source → target → relationship triples) — spec §4
 *   3. The minimum confidence threshold — spec §20
 *
 * This is the enforcement layer between the LLM's suggestions and the database.
 * Nothing reaches the DB without passing through here.
 *
 * Flow per spec §16:
 *   USER TEXT → LLM → OBJECTS + POSSIBLE CONNECTIONS
 *     → CONNECTION VALIDATOR → CONNECTION MATRIX → ACCEPT / REJECT → DATABASE
 *
 * All functions are pure: no side effects, no DB access, no network calls.
 */
import { isAllowedRelationship } from './connection-matrix.js';
import {
  CONNECTION_MAP_OBJECT_TYPE_SET,
  FORBIDDEN_OBJECT_TYPES,
  OBJECT_TYPE_ALIASES,
  MIN_RELATIONSHIP_CONFIDENCE,
  type ConnectionMapObjectType,
} from './connection-types.js';

// ---------------------------------------------------------------------------
// Phase 1 EntityKind → V2 Connection Map type mapping
// ---------------------------------------------------------------------------

/**
 * Maps Phase 1 analysis entity kinds to V2 Connection Map object types.
 *
 * Spec §2 object types: person, place, project, organization, event, object, other
 *
 * Mappings:
 *  PERSON       → person
 *  PLACE        → place
 *  ORGANIZATION → organization
 *  OBJECT       → physical_object   (spec "object"; internal name)
 *  EVENT_NAME   → event
 *  TOPIC        → other_entity      (spec "other"; internal name)
 *  OTHER        → other_entity      (preserves raw_kind in attributes)
 *
 * Returns 'other_entity' for all unrecognised kinds.
 */
export function mapEntityKindToObjectType(
  entityKind: string,
  rawKind?: string | null,
): ConnectionMapObjectType {
  const upper = entityKind.toUpperCase().trim();

  switch (upper) {
    case 'PERSON':
      return 'person';
    case 'PLACE':
      return 'place';
    case 'ORGANIZATION':
      return 'organization';
    case 'PROJECT':
      return 'project';
    case 'OBJECT':
      return 'physical_object';
    case 'EVENT_NAME':
    case 'EVENT':
      return 'event';
    case 'TOPIC':
    case 'OTHER':
    default:
      // If rawKind is itself a recognised V2 type, promote it.
      if (rawKind) {
        const rawLower = rawKind.toLowerCase().trim();
        // Check for alias first ("object" → "physical_object")
        if (OBJECT_TYPE_ALIASES[rawLower]) {
          return OBJECT_TYPE_ALIASES[rawLower]!;
        }
        if (CONNECTION_MAP_OBJECT_TYPE_SET.has(rawLower)) {
          return rawLower as ConnectionMapObjectType;
        }
        // rawKind is a novel type — falls through to other_entity.
        // The caller should store rawKind in attributes for traceability.
      }
      return 'other_entity';
  }
}

// ---------------------------------------------------------------------------
// Object type validation
// ---------------------------------------------------------------------------

export interface ObjectTypeValidationResult {
  /** Normalised V2 internal type to use, or null if the object should be dropped. */
  resolvedType: ConnectionMapObjectType | null;
  /**
   * If the type was remapped to other_entity, contains the original type so
   * it can be stored in attributes.raw_kind for traceability.
   */
  originalType?: string;
  /** Why the object was dropped (only set when resolvedType is null). */
  rejectionReason?: string;
}

/**
 * Validate and resolve an object type string.
 *
 * Accepts:
 *  - Any of the 7 canonical V2 internal types (person, place, project,
 *    organization, event, physical_object, other_entity)
 *  - Public aliases: "object" → physical_object, "other" → other_entity
 *
 * Maps to other_entity:
 *  - Any unrecognised non-forbidden type (spec: never discard unknown entities)
 *
 * Rejects (returns resolvedType: null):
 *  - Types on the FORBIDDEN_OBJECT_TYPES list — spec §3
 *  - Empty / whitespace-only strings
 */
export function validateObjectType(rawType: string): ObjectTypeValidationResult {
  const normalised = rawType.toLowerCase().trim();

  if (!normalised) {
    return {
      resolvedType: null,
      rejectionReason: 'empty type string',
    };
  }

  // Hard rejection: forbidden types must never enter the Connection Map (spec §3).
  if (FORBIDDEN_OBJECT_TYPES.has(normalised)) {
    return {
      resolvedType: null,
      rejectionReason: `"${normalised}" is a forbidden Connection Map type — belongs to task/memory system, not the graph`,
    };
  }

  // Check public alias first: "object" → "physical_object", "other" → "other_entity"
  if (OBJECT_TYPE_ALIASES[normalised]) {
    return { resolvedType: OBJECT_TYPE_ALIASES[normalised]! };
  }

  // Known internal V2 type — use directly.
  if (CONNECTION_MAP_OBJECT_TYPE_SET.has(normalised)) {
    return { resolvedType: normalised as ConnectionMapObjectType };
  }

  // Unknown type — map to other_entity and preserve original for traceability.
  // Spec: "If something does not fit these categories: other"
  return {
    resolvedType: 'other_entity',
    originalType: normalised,
  };
}

// ---------------------------------------------------------------------------
// Relationship validation
// ---------------------------------------------------------------------------

export interface RelationshipValidationResult {
  accepted: boolean;
  /** Why the relationship was rejected (only set when accepted is false). */
  rejectionReason?: string;
}

/**
 * Validate a candidate relationship against:
 *   1. Confidence threshold — spec §20
 *   2. Connection Matrix (source type × target type × relationship type) — spec §4, §16
 *
 * The LLM must never decide what is a valid connection.
 * This function is the authoritative gate.
 *
 * Returns accepted: false for any relationship not in the matrix,
 * regardless of how plausible it sounds.
 */
export function validateConnectionRelationship(
  sourceType: string,
  targetType: string,
  relationshipType: string,
  confidence: number,
): RelationshipValidationResult {
  // 1. Confidence gate.
  if (confidence < MIN_RELATIONSHIP_CONFIDENCE) {
    return {
      accepted: false,
      rejectionReason: `confidence ${confidence.toFixed(2)} is below minimum ${MIN_RELATIONSHIP_CONFIDENCE}`,
    };
  }

  // 2. Connection Matrix gate — spec §4, §5, §16.
  if (!isAllowedRelationship(sourceType, targetType, relationshipType)) {
    return {
      accepted: false,
      rejectionReason: `relationship "${relationshipType}" between "${sourceType}" → "${targetType}" is not in the Connection Matrix`,
    };
  }

  return { accepted: true };
}

// ---------------------------------------------------------------------------
// Name validation
// ---------------------------------------------------------------------------

/**
 * Validate an entity name from the LLM.
 * Returns the cleaned name or null if it is invalid.
 */
export function validateEntityName(name: unknown): string | null {
  if (typeof name !== 'string') return null;
  const trimmed = name.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > 255) return null;
  return trimmed;
}
