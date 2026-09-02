/**
 * Memory validation (V2)
 *
 * Validates objects and relationships before database writes.
 * No AI output reaches the database without passing through here.
 *
 * KNOWN_RELATIONSHIP_TYPES is derived from the Connection Matrix (spec §4).
 * It contains exactly the relationships the matrix allows — no more.
 *
 * See docs/memory.md — Connection Map V2 and docs/algorithm.md.
 * "Do not let AI output reach SQL directly."
 */
import { FORBIDDEN_OBJECT_TYPES, MIN_RELATIONSHIP_CONFIDENCE } from '../modules/connection-map/connection-types.js';
import { getAllMatrixRelationshipTypes } from '../modules/connection-map/connection-matrix.js';

// ---------------------------------------------------------------------------
// Relationship type allow-list
//
// Derived from the Connection Matrix so it stays in sync automatically.
// These are ALL and ONLY the relationships in the spec §4 matrix.
// ---------------------------------------------------------------------------

/**
 * The complete set of relationship types recognised by the Connection Map V2.
 * Derived from spec §4 Connection Matrix — single source of truth.
 *
 * DO NOT add types here. Add them to connection-matrix.ts first.
 */
export const KNOWN_RELATIONSHIP_TYPES = [
  // PERSON → PERSON
  'knows',
  'works_with',
  'related_to',
  // PERSON → PROJECT
  'works_on',
  // PERSON → PLACE
  'lives_in',
  'works_at',
  'visited',
  // PERSON → ORGANIZATION
  'member_of',
  // PERSON → EVENT / EVENT → PERSON
  'participated_in',
  // PROJECT → ORGANIZATION
  'belongs_to',
  // PROJECT → PLACE / ORGANIZATION → PLACE / OBJECT → PLACE
  'located_at',
  // PROJECT → EVENT / EVENT → PROJECT
  'related_to',  // duplicate listed above is fine — Set deduplicates
  // EVENT → PLACE
  'happened_at',
  // PROJECT → OBJECT / EVENT → OBJECT
  'uses',
] as const;

export type KnownRelationshipType = (typeof KNOWN_RELATIONSHIP_TYPES)[number];

/** O(1) lookup. Merges hard-coded list with Connection Matrix for completeness. */
const KNOWN_RELATIONSHIP_TYPE_SET: Set<string> = (() => {
  const s = new Set<string>(KNOWN_RELATIONSHIP_TYPES);
  // Also add anything the matrix knows about (keeps the two in sync at runtime)
  for (const rel of getAllMatrixRelationshipTypes()) {
    s.add(rel);
  }
  return s;
})();

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

export interface ValidationError {
  field: string;
  message: string;
}

// ---------------------------------------------------------------------------
// Object type validation
// ---------------------------------------------------------------------------

/**
 * Check whether an object type is allowed in the Connection Map.
 *
 * Returns an error if the type is on the FORBIDDEN_OBJECT_TYPES list.
 * This is the final guard before persistence.
 */
export function validateObjectTypeAllowed(
  type: string,
  index: number,
): ValidationError[] {
  const errors: ValidationError[] = [];
  const lower = type.toLowerCase().trim();
  if (FORBIDDEN_OBJECT_TYPES.has(lower)) {
    errors.push({
      field: `objects[${index}].type`,
      message: `"${lower}" is a forbidden Connection Map type and must not become a graph node`,
    });
  }
  return errors;
}

// ---------------------------------------------------------------------------
// Object candidate validation
// ---------------------------------------------------------------------------

/**
 * Validate an object candidate. Returns errors if invalid.
 */
export function validateObject(
  obj: { type?: unknown; name?: unknown; attributes?: unknown; confidence?: unknown },
  index: number,
): ValidationError[] {
  const errors: ValidationError[] = [];
  const prefix = `objects[${index}]`;

  if (typeof obj.type !== 'string' || obj.type.trim().length === 0) {
    errors.push({ field: `${prefix}.type`, message: 'type must be a non-empty string' });
  } else if (obj.type.length > 64) {
    errors.push({ field: `${prefix}.type`, message: 'type must be at most 64 characters' });
  } else {
    // Also run forbidden-type check here as a belt-and-suspenders guard
    errors.push(...validateObjectTypeAllowed(obj.type, index));
  }

  if (typeof obj.name !== 'string' || obj.name.trim().length === 0) {
    errors.push({ field: `${prefix}.name`, message: 'name must be a non-empty string' });
  }

  if (obj.attributes != null && typeof obj.attributes !== 'object') {
    errors.push({ field: `${prefix}.attributes`, message: 'attributes must be an object' });
  }

  if (obj.confidence != null) {
    const conf = Number(obj.confidence);
    if (Number.isNaN(conf) || conf < 0 || conf > 1) {
      errors.push({ field: `${prefix}.confidence`, message: 'confidence must be between 0 and 1' });
    }
  }

  return errors;
}

// ---------------------------------------------------------------------------
// Relationship type normalisation
// ---------------------------------------------------------------------------

/**
 * Normalise a relationship type.
 *
 * The Connection Matrix validator is authoritative; anything not in the matrix
 * is rejected upstream. This function is a last-resort normaliser for types
 * that have already passed the matrix.
 */
export function normalizeRelationshipType(type: string): string {
  return type.toLowerCase().trim().replace(/\s+/g, '_');
}

// ---------------------------------------------------------------------------
// Relationship candidate validation
// ---------------------------------------------------------------------------

/**
 * Validate a relationship candidate.
 *
 *  - Rejects confidence below MIN_RELATIONSHIP_CONFIDENCE
 *  - Only allows types in KNOWN_RELATIONSHIP_TYPE_SET (derived from spec §4 matrix)
 *  - No 'custom:' prefixed types — unknown types are rejected, not stored
 */
export function validateRelationship(
  rel: {
    source?: unknown;
    target?: unknown;
    type?: unknown;
    confidence?: unknown;
  },
  index: number,
  validObjectKeys: Set<string>,
): ValidationError[] {
  const errors: ValidationError[] = [];
  const prefix = `relationships[${index}]`;

  if (typeof rel.source !== 'string' || rel.source.trim().length === 0) {
    errors.push({ field: `${prefix}.source`, message: 'source must be a non-empty string' });
  } else if (!validObjectKeys.has(rel.source)) {
    errors.push({
      field: `${prefix}.source`,
      message: `source "${rel.source}" does not reference a valid object`,
    });
  }

  if (typeof rel.target !== 'string' || rel.target.trim().length === 0) {
    errors.push({ field: `${prefix}.target`, message: 'target must be a non-empty string' });
  } else if (!validObjectKeys.has(rel.target)) {
    errors.push({
      field: `${prefix}.target`,
      message: `target "${rel.target}" does not reference a valid object`,
    });
  }

  // No self-referencing relationships.
  if (
    typeof rel.source === 'string' &&
    typeof rel.target === 'string' &&
    rel.source === rel.target
  ) {
    errors.push({ field: `${prefix}`, message: 'self-referencing relationship is not allowed' });
  }

  if (typeof rel.type !== 'string' || rel.type.trim().length === 0) {
    errors.push({ field: `${prefix}.type`, message: 'type must be a non-empty string' });
  } else {
    const normalised = normalizeRelationshipType(rel.type);
    if (!KNOWN_RELATIONSHIP_TYPE_SET.has(normalised)) {
      errors.push({
        field: `${prefix}.type`,
        message: `"${normalised}" is not a recognised Connection Map relationship type (see spec §4 Connection Matrix)`,
      });
    }
  }

  if (rel.confidence != null) {
    const conf = Number(rel.confidence);
    if (Number.isNaN(conf) || conf < 0 || conf > 1) {
      errors.push({
        field: `${prefix}.confidence`,
        message: 'confidence must be between 0 and 1',
      });
    } else if (conf < MIN_RELATIONSHIP_CONFIDENCE) {
      errors.push({
        field: `${prefix}.confidence`,
        message: `confidence ${conf.toFixed(2)} is below the minimum threshold of ${MIN_RELATIONSHIP_CONFIDENCE}`,
      });
    }
  }

  return errors;
}

// ---------------------------------------------------------------------------
// Duplicate detection
// ---------------------------------------------------------------------------

/**
 * Check for duplicate relationships in a batch.
 * Same source + target + type should not appear more than once.
 */
export function findDuplicateRelationships(
  relationships: Array<{ source: string; target: string; type: string }>,
): number[] {
  const seen = new Set<string>();
  const duplicateIndices: number[] = [];

  for (const [i, rel] of relationships.entries()) {
    const key = `${rel.source}|${rel.target}|${normalizeRelationshipType(rel.type)}`;
    if (seen.has(key)) {
      duplicateIndices.push(i);
    } else {
      seen.add(key);
    }
  }

  return duplicateIndices;
}

// ---------------------------------------------------------------------------
// Legacy exports (kept for backward compat with any callers expecting them)
// ---------------------------------------------------------------------------

export interface ValidatedObject {
  type: string;
  name: string;
  attributes: Record<string, unknown>;
  confidence: number;
}

export interface ValidatedRelationship {
  sourceObjectKey: string;
  targetObjectKey: string;
  relationshipType: string;
  confidence: number;
}
