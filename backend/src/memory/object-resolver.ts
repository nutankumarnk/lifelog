/**
 * Object resolver.
 *
 * Given a candidate object (type + name), determines whether it matches an
 * existing memory object. Pure logic — no SQL, no AI.
 *
 * Resolution is deliberately conservative: exact normalized-name match within
 * the same type. A false merge (combining two different people named "Arun")
 * corrupts the memory graph invisibly. A missed merge (keeping two rows for
 * the same Arun) is visible and fixable. Same asymmetry as grounding.
 *
 * See docs/decision.md D-016.
 */

/**
 * Normalise a name for matching: lowercase, collapse whitespace, trim.
 * The displayed name stays as the user wrote it; this is for comparison only.
 */
export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[\u2018\u2019`]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Normalise an object type for matching: lowercase, trim.
 */
export function normalizeType(type: string): string {
  return type.toLowerCase().trim();
}

export interface CandidateObject {
  type: string;
  name: string;
  attributes?: Record<string, unknown>;
  confidence?: number;
}

export interface ExistingObject {
  id: string;
  type: string;
  name: string;
  normalizedName: string;
}

export interface ResolutionResult {
  /** The matched object id, or null if no match was found. */
  existingId: string | null;
  /** Whether a new object should be created. */
  isNew: boolean;
  /** Confidence in the match (1.0 for exact, lower for partial). */
  matchConfidence: number;
  /** The normalised name used for matching. */
  normalizedName: string;
  /** The normalised type used for matching. */
  normalizedType: string;
}

/**
 * Attempt to resolve a candidate object against a list of existing objects.
 *
 * Current strategy: exact match on normalised name within the same normalised
 * type. No fuzzy matching yet — see D-016 for rationale.
 */
export function resolveObject(
  candidate: CandidateObject,
  existingObjects: ExistingObject[],
): ResolutionResult {
  const normalizedName = normalizeName(candidate.name);
  const normalizedType = normalizeType(candidate.type);

  // Exact match: same type and same normalised name.
  const match = existingObjects.find(
    (obj) =>
      normalizeType(obj.type) === normalizedType &&
      obj.normalizedName === normalizedName,
  );

  if (match) {
    return {
      existingId: match.id,
      isNew: false,
      matchConfidence: 1.0,
      normalizedName,
      normalizedType,
    };
  }

  return {
    existingId: null,
    isNew: true,
    matchConfidence: 0,
    normalizedName,
    normalizedType,
  };
}
