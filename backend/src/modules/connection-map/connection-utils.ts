/**
 * Connection Map Utilities (V2)
 *
 * Shared helper functions used across the connection-map module.
 * Pure functions — no side effects, no DB access.
 */
import { CONNECTION_MAP_OBJECT_TYPE_SET } from './connection-types.js';

// ---------------------------------------------------------------------------
// Type normalisation
// ---------------------------------------------------------------------------

/**
 * Normalise an object type string: lowercase, trim, collapse whitespace.
 *
 * Does NOT validate whether the result is in the allowed set — use
 * validateObjectType() in connection-validator.ts for that.
 */
export function normalizeObjectType(type: string): string {
  return type.toLowerCase().trim().replace(/\s+/g, '_');
}

/**
 * Normalise a relationship type string: lowercase, trim, replace spaces
 * with underscores.
 *
 * Does NOT validate against the Connection Matrix — use
 * validateConnectionRelationship() for that.
 */
export function normalizeRelationshipType(type: string): string {
  return type.toLowerCase().trim().replace(/\s+/g, '_');
}

// ---------------------------------------------------------------------------
// Dedup key
// ---------------------------------------------------------------------------

/**
 * Build a deduplication key for a relationship within a batch.
 * Ensures the same (source, target, type) triple is not processed twice.
 */
export function buildRelationshipKey(
  sourceId: string,
  targetId: string,
  relType: string,
): string {
  return `${sourceId}|${targetId}|${normalizeRelationshipType(relType)}`;
}

// ---------------------------------------------------------------------------
// Type guards
// ---------------------------------------------------------------------------

/**
 * Return true if the given string is a recognised V2 Connection Map object type.
 */
export function isKnownObjectType(type: string): boolean {
  return CONNECTION_MAP_OBJECT_TYPE_SET.has(normalizeObjectType(type));
}
