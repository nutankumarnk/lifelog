/**
 * Connection builder (V2)
 *
 * Receives Phase 1 analysis output (entities + items) and produces
 * candidate memory objects and relationships for the Connection Map.
 *
 * V2 rules (spec §2–§20):
 *
 *   OBJECTS
 *   -------
 *   - Only Phase 1 entities become Connection Map objects.
 *   - Phase 1 items of type PAST_EVENT / FUTURE_EVENT become `event` objects
 *     when they have a meaningful name and represent a real-world occurrence.
 *   - TASK, REMINDER, DECISION, FEELING, MEMORY, PRESENT_FACT items must NEVER
 *     become Connection Map nodes — spec §3, §12, §13, §14.
 *   - Entity kinds are mapped to V2 types via connection-validator.mapEntityKindToObjectType.
 *   - Unknown entity types become `other_entity` (never discarded).
 *
 *   RELATIONSHIPS
 *   -------------
 *   - Direct model relationships must carry verbatim evidence and pass the matrix.
 *   - Event participation/location can also be derived from item_entity links.
 *   - Two entities co-occurring in the same sentence does NOT automatically
 *     create a relationship — spec §6, §8, §20.
 *   - Only relationships in the spec §4 Connection Matrix are created.
 *   - All candidates pass through validateBuilderCandidates before returning.
 *
 * IMPORTANT — spec §16:
 *   The builder does NOT decide what is a valid connection.
 *   It only extracts objects and infers possible relationships.
 *   The CONNECTION VALIDATOR decides what is accepted.
 *
 * This module never writes to the database.
 */
import type { Analysis } from '../schemas/analysis.schema.js';
import {
  mapEntityKindToObjectType,
  validateBuilderCandidates,
} from '../modules/connection-map/connection-service.js';
import { validateConnectionRelationship } from '../modules/connection-map/connection-validator.js';
import { isAllowedRelationship } from '../modules/connection-map/connection-matrix.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CandidateMemoryObject {
  /** Temporary id within this batch — used by relationships to reference objects. */
  tempId: string;
  type: string;
  name: string;
  attributes: Record<string, unknown>;
  confidence: number;
  /** Phase 1 entity id that produced this, if applicable. */
  sourceEntityId?: string;
  /** Phase 1 item id that produced this, if applicable. */
  sourceItemId?: string;
}

export interface CandidateRelationship {
  /** Temp id of the source object. */
  sourceTempId: string;
  /** Temp id of the target object. */
  targetTempId: string;
  relationshipType: string;
  confidence: number;
  /** Verbatim source text evidencing this relationship. */
  evidence: string;
}

export interface ConnectionBuilderResult {
  objects: CandidateMemoryObject[];
  relationships: CandidateRelationship[];
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Item types that are allowed to produce event objects
// ---------------------------------------------------------------------------

/**
 * Only these item types can produce Connection Map `event` objects.
 * Everything else stays in the task/memory/action system — spec §3.
 */
const EVENT_ITEM_TYPES = new Set(['PAST_EVENT', 'FUTURE_EVENT']);

/**
 * These item types must NEVER become Connection Map objects — spec §3.
 * Checked as a safety net even though validateBuilderCandidates also rejects them.
 */
const FORBIDDEN_ITEM_TYPES = new Set([
  'TASK',
  'REMINDER',
  'DECISION',
  'FEELING',
  'MEMORY',
  'PRESENT_FACT',
]);

// ---------------------------------------------------------------------------
// Relationship inference — entity kind × item type → relationship type
// ---------------------------------------------------------------------------

/**
 * Infer a Connection-Matrix-valid relationship between a Phase 1 entity and
 * a Phase 1 event item.
 *
 * Per spec §4 matrix, the only valid entity→event / event→entity relationships are:
 *   person   → event:  participated_in
 *   event    → place:  happened_at  (handled from event side below)
 *
 * Returns null if no meaningful, matrix-allowed relationship exists.
 * Only creates relationships that are explicitly supported by the analysis.
 *
 * Spec §16: This function does NOT decide validity — it proposes a relationship.
 * The Connection Matrix check in Step 5 is the authority.
 */
function inferEntityEventRelationship(
  entityKind: string,
): string | null {
  switch (entityKind.toUpperCase()) {
    case 'PERSON':
      // person → participated_in → event  (spec §4: PERSON → EVENT: participated_in)
      return 'participated_in';

    case 'PROJECT':
      // project → related_to → event  (spec §4: PROJECT → EVENT: related_to)
      return 'related_to';

    case 'PLACE':
      // event → happened_at → place  (handled from the event side, not entity side)
      return null;

    default:
      // No defined relationship for other entity kinds attached to events.
      // Spec §20: "If there is no strong evidence: DO NOTHING."
      return null;
  }
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

/**
 * Build candidate Connection Map objects and relationships from a Phase 1 analysis.
 *
 * Step 1: Entities → V2-typed memory object candidates
 * Step 2: Event items (PAST_EVENT / FUTURE_EVENT) → `event` object candidates
 * Step 3: Apply V2 object validation (forbidden types, type mapping)
 * Step 4: Relationships from item_entity links only — spec §6, §8
 * Step 5: Validate relationships against Connection Matrix — spec §4, §16
 */
export function buildConnections(analysis: Analysis): ConnectionBuilderResult {
  const rawObjects: CandidateMemoryObject[] = [];
  const rawRelationships: CandidateRelationship[] = [];
  const warnings: string[] = [];

  // Track temp id → entity/item local id for relationship wiring
  const entityTempIds = new Map<string, string>();   // entity.id → tempId
  const entityKinds = new Map<string, string>();     // entity.id → entity.kind
  const entityV2Types = new Map<string, string>();   // entity.id → V2 type
  const itemTempIds = new Map<string, string>();     // item.id → tempId

  // --- Step 1: Entities → Connection Map objects ---------------------------
  for (const entity of analysis.entities) {
    const tempId = `ent_${entity.id}`;

    // Map Phase 1 entity kind → V2 Connection Map type
    const v2Type = mapEntityKindToObjectType(entity.kind, entity.raw_kind ?? null);

    rawObjects.push({
      tempId,
      type: v2Type,
      name: entity.name,
      attributes: {
        ...(entity.relation ? { relation: entity.relation } : {}),
        ...(entity.aliases && entity.aliases.length > 0 ? { aliases: entity.aliases } : {}),
        ...(entity.raw_kind ? { raw_kind: entity.raw_kind } : {}),
        ...entity.attributes,
      },
      confidence: entity.confidence,
      sourceEntityId: entity.id,
    });

    entityTempIds.set(entity.id, tempId);
    entityKinds.set(entity.id, entity.kind);
    entityV2Types.set(entity.id, v2Type);
  }

  // --- Step 2: Event items → Connection Map `event` objects ----------------
  for (const item of analysis.items) {
    // Hard guard: forbidden item types must NEVER enter the Connection Map — spec §3
    if (FORBIDDEN_ITEM_TYPES.has(item.type)) continue;
    // Only PAST_EVENT and FUTURE_EVENT become event objects
    if (!EVENT_ITEM_TYPES.has(item.type)) continue;
    // Skip items without a meaningful title
    if (!item.title || item.title.trim().length === 0) continue;

    const tempId = `item_${item.id}`;

    rawObjects.push({
      tempId,
      type: 'event',
      name: item.title,
      attributes: {
        ...(item.summary ? { summary: item.summary } : {}),
        ...(item.source_text ? { source_text: item.source_text } : {}),
        tense: item.temporal.tense,
        ...(item.temporal.raw ? { temporal_raw: item.temporal.raw } : {}),
        ...(item.temporal.resolved ? { occurred_at: item.temporal.resolved } : {}),
      },
      confidence: item.confidence,
      sourceItemId: item.id,
    });

    itemTempIds.set(item.id, tempId);
  }

  // --- Step 3: Apply V2 object validation ----------------------------------
  const { accepted: validObjects, warnings: objectWarnings } = validateBuilderCandidates(rawObjects);
  warnings.push(...objectWarnings);

  // Build a set of accepted temp ids for relationship validation
  const acceptedTempIds = new Set(validObjects.map((o) => o.tempId));

  // Rebuild lookup maps restricted to accepted objects
  const acceptedEntityTempIds = new Map<string, string>();
  for (const [entityId, tempId] of entityTempIds) {
    if (acceptedTempIds.has(tempId)) {
      acceptedEntityTempIds.set(entityId, tempId);
    }
  }
  const acceptedItemTempIds = new Map<string, string>();
  for (const [itemId, tempId] of itemTempIds) {
    if (acceptedTempIds.has(tempId)) {
      acceptedItemTempIds.set(itemId, tempId);
    }
  }

  // --- Step 4: Relationships from item_entity links ONLY -------------------
  //
  // Spec §6: "A connection should represent a meaningful real-world
  // relationship. Do NOT create a connection simply because two entities
  // appeared in the same sentence or conversation."
  //
  // Spec §8: "People do not automatically connect."
  //
  // We create relationships only when:
  //   a) An entity is explicitly linked to an event item via entity_ids
  //   b) The resulting (entityType, eventType, relationshipType) triple is
  //      allowed by the Connection Matrix

  const seenRelKeys = new Set<string>();

  // Prefer the model's direct, evidence-grounded relationship suggestions.
  // They have already been normalised against entity ids and source text; the
  // matrix below is still the final authority on whether they are accepted.
  for (const connection of analysis.connections ?? []) {
    let sourceTempId = acceptedEntityTempIds.get(connection.source_entity_id);
    let targetTempId = acceptedEntityTempIds.get(connection.target_entity_id);
    if (!sourceTempId || !targetTempId || sourceTempId === targetTempId) continue;

    let sourceType = acceptedTypeForEntity(connection.source_entity_id, entityV2Types);
    let targetType = acceptedTypeForEntity(connection.target_entity_id, entityV2Types);
    const relationshipType = connection.relationship_type.toLowerCase().trim();

    // Models sometimes reverse a relationship despite the prompt. Reverse it
    // only when the same typed relationship is valid in the other direction.
    if (!isAllowedRelationship(sourceType, targetType, relationshipType)
      && isAllowedRelationship(targetType, sourceType, relationshipType)) {
      [sourceTempId, targetTempId] = [targetTempId, sourceTempId];
      [sourceType, targetType] = [targetType, sourceType];
    }

    const relKey = `${sourceTempId}|${targetTempId}|${relationshipType}`;
    if (seenRelKeys.has(relKey)) continue;
    seenRelKeys.add(relKey);
    rawRelationships.push({
      sourceTempId,
      targetTempId,
      relationshipType,
      confidence: connection.confidence,
      evidence: connection.evidence,
    });
  }

  for (const item of analysis.items) {
    // Only relate entities to event objects (the only items that become nodes)
    if (!EVENT_ITEM_TYPES.has(item.type)) continue;

    const itemTempId = acceptedItemTempIds.get(item.id);
    if (!itemTempId) continue; // event item was rejected by validation

    for (const entityLocalId of item.entity_ids) {
      const entityTempId = acceptedEntityTempIds.get(entityLocalId);
      if (!entityTempId) continue;

      const entityKind = entityKinds.get(entityLocalId) ?? 'OTHER';
      const entity = analysis.entities.find((e) => e.id === entityLocalId);

      // --- Entity → Event relationship (e.g. person → participated_in → event) ---
      const entityEventRel = inferEntityEventRelationship(entityKind);
      if (entityEventRel) {
        const relKey = `${entityTempId}|${itemTempId}|${entityEventRel}`;
        if (!seenRelKeys.has(relKey)) {
          seenRelKeys.add(relKey);
          rawRelationships.push({
            sourceTempId: entityTempId,
            targetTempId: itemTempId,
            relationshipType: entityEventRel,
            confidence: Math.min(entity?.confidence ?? 0.5, item.confidence),
            evidence: item.source_text || item.title,
          });
        }
      }

      // --- Event → Place relationship (event → happened_at → place) -----------
      // Spec §4: EVENT → PLACE: happened_at
      // Spec §10: "An event represents something that actually happened."
      if (entityKind === 'PLACE' && isAllowedRelationship('event', 'place', 'happened_at')) {
        const relKey = `${itemTempId}|${entityTempId}|happened_at`;
        if (!seenRelKeys.has(relKey)) {
          seenRelKeys.add(relKey);
          rawRelationships.push({
            sourceTempId: itemTempId,
            targetTempId: entityTempId,
            relationshipType: 'happened_at',
            confidence: Math.min(entity?.confidence ?? 0.5, item.confidence),
            evidence: item.source_text || item.title,
          });
        }
      }
    }
  }

  // Spec §16: "The BACKEND decides whether the relationship is allowed."
  const validRelationships: CandidateRelationship[] = [];

  // Build a type lookup for accepted objects
  const acceptedTypeByTempId = new Map<string, string>();
  for (const obj of validObjects) {
    acceptedTypeByTempId.set(obj.tempId, obj.type);
  }

  for (const rel of rawRelationships) {
    const sourceType = acceptedTypeByTempId.get(rel.sourceTempId);
    const targetType = acceptedTypeByTempId.get(rel.targetTempId);

    if (!sourceType || !targetType) {
      warnings.push(`Skipped relationship: endpoint not found (${rel.sourceTempId} → ${rel.targetTempId})`);
      continue;
    }

    if (rel.sourceTempId === rel.targetTempId) {
      warnings.push(`Skipped self-referencing relationship: ${rel.sourceTempId}`);
      continue;
    }

    const result = validateConnectionRelationship(
      sourceType,
      targetType,
      rel.relationshipType,
      rel.confidence,
    );

    if (!result.accepted) {
      warnings.push(
        `Skipped relationship "${rel.relationshipType}" (${sourceType} → ${targetType}): ${result.rejectionReason}`,
      );
      continue;
    }

    validRelationships.push(rel);
  }

  return { objects: validObjects, relationships: validRelationships, warnings };
}

function acceptedTypeForEntity(entityId: string, entityTypes: Map<string, string>): string {
  return entityTypes.get(entityId) ?? 'other_entity';
}
