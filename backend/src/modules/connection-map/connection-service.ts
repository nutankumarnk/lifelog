/**
 * Connection Service (V2)
 *
 * Pure orchestration layer: takes raw LLM extraction output and runs it
 * through the full validation pipeline, returning only the accepted objects
 * and relationships.
 *
 * Flow (spec §19):
 *   LLM output
 *     → validateObjectType   (per object)
 *     → validateEntityName   (per object)
 *     → validateConnectionRelationship (per relationship)
 *     → duplicate suppression
 *     → ConnectionValidationResult
 *
 * This module is STATELESS. No DB access, no network calls.
 * The memory service consumes its output and handles persistence.
 *
 * Spec §21: "LLM understands conversation, detects entities, suggests
 * relationships. Our algorithm validates, prevents invalid connections,
 * prevents duplicates, applies Connection Matrix rules."
 */
import {
  mapEntityKindToObjectType,
  validateConnectionRelationship,
  validateEntityName,
  validateObjectType,
} from './connection-validator.js';
import type {
  ConnectionValidationResult,
  LlmExtractionResult,
  ValidatedConnectionObject,
  ValidatedConnectionRelationship,
} from './connection-types.js';
import { normalizeObjectType } from './connection-utils.js';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Validate and filter raw LLM extraction output.
 *
 * Every accepted object is guaranteed to:
 *   - Have a non-empty name
 *   - Have a V2-valid (or remapped) type
 *   - Not be a forbidden type (task, reminder, decision, feeling, etc.)
 *
 * Every accepted relationship is guaranteed to:
 *   - Reference two accepted objects
 *   - Meet the minimum confidence threshold
 *   - Be permitted by the Connection Matrix for the given (source, target) type pair
 *
 * @param llmOutput - Raw JSON from the LLM. May contain invalid types, forbidden
 *   types, unsupported relationships, and low-confidence guesses.
 * @returns Validated objects and relationships, plus warnings about what was dropped.
 */
export function validateLlmExtractionOutput(
  llmOutput: LlmExtractionResult,
): ConnectionValidationResult {
  const warnings: string[] = [];
  const acceptedObjects: ValidatedConnectionObject[] = [];

  // Map from temporary_id → accepted object (for relationship wiring)
  const acceptedObjectMap = new Map<string, ValidatedConnectionObject>();

  // -------------------------------------------------------------------
  // Phase 1: Validate objects
  // -------------------------------------------------------------------
  for (const rawObj of llmOutput.objects) {
    // Name check
    const name = validateEntityName(rawObj.name);
    if (!name) {
      warnings.push(`Dropped object "${rawObj.temporary_id}": invalid or empty name`);
      continue;
    }

    // Type check
    const typeResult = validateObjectType(rawObj.type ?? '');
    if (!typeResult.resolvedType) {
      warnings.push(
        `Dropped object "${name}" (temp_id=${rawObj.temporary_id}): ${typeResult.rejectionReason}`,
      );
      continue;
    }

    const obj: ValidatedConnectionObject = {
      temporaryId: rawObj.temporary_id,
      type: typeResult.resolvedType,
      name,
      attributes: {
        ...(rawObj.attributes ?? {}),
        // Preserve original type for traceability when remapped to other_entity
        ...(typeResult.originalType ? { raw_kind: typeResult.originalType } : {}),
      },
    };

    acceptedObjects.push(obj);
    acceptedObjectMap.set(rawObj.temporary_id, obj);
  }

  // -------------------------------------------------------------------
  // Phase 2: Validate relationships
  // -------------------------------------------------------------------
  const acceptedRelationships: ValidatedConnectionRelationship[] = [];
  const seenRelKeys = new Set<string>();

  for (const rawRel of llmOutput.relationships) {
    const sourceObj = acceptedObjectMap.get(rawRel.source_temporary_id);
    const targetObj = acceptedObjectMap.get(rawRel.target_temporary_id);

    // Both endpoints must be accepted objects
    if (!sourceObj) {
      warnings.push(
        `Dropped relationship: source "${rawRel.source_temporary_id}" was not an accepted object`,
      );
      continue;
    }
    if (!targetObj) {
      warnings.push(
        `Dropped relationship: target "${rawRel.target_temporary_id}" was not an accepted object`,
      );
      continue;
    }

    // No self-referencing
    if (rawRel.source_temporary_id === rawRel.target_temporary_id) {
      warnings.push(
        `Dropped relationship: self-referencing "${rawRel.source_temporary_id}" → "${rawRel.target_temporary_id}"`,
      );
      continue;
    }

    // Connection Matrix + confidence check
    const relType = (rawRel.relationship_type ?? '').toLowerCase().trim();
    const sourceType = normalizeObjectType(sourceObj.type);
    const targetType = normalizeObjectType(targetObj.type);
    const confidence = typeof rawRel.confidence === 'number' ? rawRel.confidence : 0;

    const relResult = validateConnectionRelationship(sourceType, targetType, relType, confidence);
    if (!relResult.accepted) {
      warnings.push(
        `Dropped relationship "${sourceObj.name}" → [${relType}] → "${targetObj.name}": ${relResult.rejectionReason}`,
      );
      continue;
    }

    // Duplicate suppression within the batch
    const relKey = `${rawRel.source_temporary_id}|${rawRel.target_temporary_id}|${relType}`;
    if (seenRelKeys.has(relKey)) {
      warnings.push(
        `Skipped duplicate relationship "${sourceObj.name}" → [${relType}] → "${targetObj.name}"`,
      );
      continue;
    }
    seenRelKeys.add(relKey);

    acceptedRelationships.push({
      sourceTemporaryId: rawRel.source_temporary_id,
      targetTemporaryId: rawRel.target_temporary_id,
      relationshipType: relType,
      confidence,
      evidence: rawRel.evidence ?? '',
    });
  }

  return {
    objects: acceptedObjects,
    relationships: acceptedRelationships,
    warnings,
  };
}

/**
 * Validate a batch of candidate objects produced by the Phase 1 connection
 * builder (which reads Phase 1 entities/items, not LLM-extracted JSON).
 *
 * This is the bridge between the Phase 1 pipeline output and the V2 rules.
 *
 * @param candidates - Objects already partially typed by connection-builder.ts
 * @returns The same candidates with V2 types applied and forbidden types removed.
 */
export function validateBuilderCandidates(
  candidates: Array<{
    tempId: string;
    type: string;
    name: string;
    attributes: Record<string, unknown>;
    confidence: number;
    sourceEntityId?: string;
    sourceItemId?: string;
  }>,
): {
  accepted: typeof candidates;
  warnings: string[];
} {
  const warnings: string[] = [];
  const accepted: typeof candidates = [];

  for (const candidate of candidates) {
    const name = validateEntityName(candidate.name);
    if (!name) {
      warnings.push(`Dropped builder candidate "${candidate.tempId}": invalid name`);
      continue;
    }

    const typeResult = validateObjectType(candidate.type);
    if (!typeResult.resolvedType) {
      warnings.push(
        `Dropped builder candidate "${name}" (${candidate.type}): ${typeResult.rejectionReason}`,
      );
      continue;
    }

    accepted.push({
      ...candidate,
      name,
      type: typeResult.resolvedType,
      attributes: {
        ...candidate.attributes,
        ...(typeResult.originalType ? { raw_kind: typeResult.originalType } : {}),
      },
    });
  }

  return { accepted, warnings };
}

/**
 * Validate a Phase 1 entity kind and produce a V2 object type.
 * Re-exports from connection-validator for use in the connection builder.
 */
export { mapEntityKindToObjectType };
