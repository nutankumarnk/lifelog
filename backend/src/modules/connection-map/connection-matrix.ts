/**
 * Connection Matrix — V2 Spec §4
 *
 * The ONLY allowed (sourceType, targetType, relationshipType) triples.
 *
 * Rules:
 *  - ONLY what is listed here is accepted. Nothing else.
 *  - The LLM may suggest anything; this module decides what is valid.
 *  - Never bypass this layer to write to the database.
 *  - To add a relationship type, change THIS FILE ONLY — never in the LLM
 *    prompt or in downstream code.
 *
 * Object types:
 *   person | place | project | organization | event | object | other
 *
 * Internally, "object" is stored as "physical_object" and "other" as
 * "other_entity" for historical compatibility. Both spellings are accepted
 * by the validator (connection-validator.ts).
 *
 * See docs/memory.md — Connection Map V2 for the full spec.
 */

// ---------------------------------------------------------------------------
// The matrix
//
// Structure: MATRIX[sourceType][targetType] = Set of allowed relationship types.
//
// This is the complete, authoritative list. Do not extend it without updating
// docs/memory.md and this comment block.
// ---------------------------------------------------------------------------

const MATRIX: Record<string, Record<string, ReadonlySet<string>>> = {
  // -------------------------------------------------------------------
  // PERSON as source  (spec §4)
  // -------------------------------------------------------------------
  person: {
    // PERSON → PERSON: knows, works_with, related_to
    person: new Set([
      'knows',
      'met_with',
      'works_with',
      'related_to',
    ]),
    // PERSON → PROJECT: works_on
    project: new Set([
      'discussed',
      'works_on',
    ]),
    // PERSON → PLACE: lives_in, works_at, visited
    place: new Set([
      'lives_in',
      'works_at',
      'visited',
      'met_at',
    ]),
    // PERSON → ORGANIZATION: works_at, member_of
    organization: new Set([
      'discussed',
      'works_at',
      'member_of',
    ]),
    // PERSON → EVENT: participated_in
    event: new Set([
      'participated_in',
    ]),
  },

  // -------------------------------------------------------------------
  // PROJECT as source  (spec §4)
  // -------------------------------------------------------------------
  project: {
    // PROJECT → ORGANIZATION: belongs_to
    organization: new Set([
      'belongs_to',
    ]),
    // PROJECT → PLACE: located_at
    place: new Set([
      'located_at',
    ]),
    // PROJECT → EVENT: related_to
    event: new Set([
      'related_to',
    ]),
    // PROJECT → OBJECT: uses
    physical_object: new Set([
      'uses',
    ]),
  },

  // -------------------------------------------------------------------
  // EVENT as source  (spec §4)
  // -------------------------------------------------------------------
  event: {
    // EVENT → PLACE: happened_at
    place: new Set([
      'happened_at',
    ]),
    // EVENT → PROJECT: related_to
    project: new Set([
      'related_to',
    ]),
    // EVENT → PERSON: participated_in
    person: new Set([
      'participated_in',
    ]),
    // EVENT → OBJECT: uses
    physical_object: new Set([
      'uses',
    ]),
  },

  // -------------------------------------------------------------------
  // ORGANIZATION as source  (spec §4)
  // -------------------------------------------------------------------
  organization: {
    // ORGANIZATION → PLACE: located_at
    place: new Set([
      'located_at',
    ]),
  },

  // -------------------------------------------------------------------
  // OBJECT as source  (spec §4)
  // "object" is stored internally as "physical_object"
  // -------------------------------------------------------------------
  physical_object: {
    // OBJECT → PLACE: located_at
    place: new Set([
      'located_at',
    ]),
  },

  // -------------------------------------------------------------------
  // OTHER — no outgoing relationships defined.
  //
  // Entities of unknown type ("other") become graph nodes but do not
  // receive automatic relationships. A relationship must come from an
  // explicit LLM extraction that passes the matrix check.
  // "other_entity" is the internal name for this type.
  // -------------------------------------------------------------------
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Check whether a (sourceType, targetType, relationshipType) triple is
 * permitted by the Connection Matrix.
 *
 * Returns false for:
 *  - unknown source/target types
 *  - relationship types not listed for the given pair
 *  - any guessed combinations not in the matrix
 *
 * Type aliases accepted:
 *  "object" is treated as "physical_object"
 *  "other"  is treated as "other_entity"
 */
export function isAllowedRelationship(
  sourceType: string,
  targetType: string,
  relationshipType: string,
): boolean {
  const sourceNorm = normalizeForMatrix(sourceType);
  const targetNorm = normalizeForMatrix(targetType);
  const relNorm = relationshipType.toLowerCase().trim();

  const targetMap = MATRIX[sourceNorm];
  if (!targetMap) return false;

  const allowedRels = targetMap[targetNorm];
  if (!allowedRels) return false;

  return allowedRels.has(relNorm);
}

/**
 * Alias for isAllowedRelationship — matches the name from spec §22.
 *
 * Example:
 *   isConnectionAllowed("person", "project", "works_on")  → true
 *   isConnectionAllowed("person", "project", "likes")     → false
 *   isConnectionAllowed("decision", "project", "affects") → false
 */
export const isConnectionAllowed = isAllowedRelationship;

/**
 * Return all allowed relationship types for a given (sourceType, targetType)
 * pair, or an empty set if the pair is not in the matrix.
 *
 * Accepts "object"/"other" as aliases for the internal names.
 */
export function getAllowedRelationships(
  sourceType: string,
  targetType: string,
): ReadonlySet<string> {
  const sourceNorm = normalizeForMatrix(sourceType);
  const targetNorm = normalizeForMatrix(targetType);
  return MATRIX[sourceNorm]?.[targetNorm] ?? new Set<string>();
}

/**
 * Return all relationship types that appear anywhere in the matrix.
 * Used by validation.ts to build the allow-list.
 */
export function getAllMatrixRelationshipTypes(): ReadonlySet<string> {
  const all = new Set<string>();
  for (const targetMap of Object.values(MATRIX)) {
    for (const relSet of Object.values(targetMap)) {
      for (const rel of relSet) {
        all.add(rel);
      }
    }
  }
  return all;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Normalise a type string for matrix lookup.
 * Applies lowercase + trim, and resolves the public aliases:
 *   "object" → "physical_object"
 *   "other"  → "other_entity"
 */
function normalizeForMatrix(type: string): string {
  const lower = type.toLowerCase().trim();
  if (lower === 'object') return 'physical_object';
  if (lower === 'other') return 'other_entity';
  return lower;
}
