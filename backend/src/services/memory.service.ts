/**
 * Memory service.
 *
 * Orchestrates the Phase 2 flow: take a Phase 1 analysis, build memory objects,
 * resolve them against existing objects, create origin connections (🔴 RED),
 * and build object relationships (⚫ BLACK).
 *
 * This service also provides read operations for the memory API.
 *
 * Ordering:
 *   1. Build candidate objects and relationships from the analysis
 *   2. For each candidate: resolve against existing objects
 *   3. Create/reuse memory objects
 *   4. Create origin connections (object → conversation)
 *   5. Build and validate relationships
 *   6. Persist relationships
 *
 * If this fails, the Phase 1 analysis is already saved. The memory graph
 * can be rebuilt from stored analyses at any time.
 */
import type { Analysis } from '../schemas/analysis.schema.js';
import type { MemoryRepository, MemoryObjectRow, OriginRow, RelationshipRow } from '../repositories/memory.repository.js';
import { buildConnections, type CandidateMemoryObject, type CandidateRelationship } from '../memory/connection-builder.js';
import { resolveObject, normalizeName, normalizeType, type ExistingObject } from '../memory/object-resolver.js';
import { validateObject, validateObjectTypeAllowed, validateRelationship, normalizeRelationshipType, findDuplicateRelationships, type ValidationError } from '../memory/validation.js';
import { validateConnectionRelationship } from '../modules/connection-map/connection-validator.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProcessAnalysisInput {
  conversationId: string;
  analysis: Analysis;
  analysisId: string | null;
  entityIds?: Record<string, string>;
  itemIds?: Record<string, string>;
}

export interface ProcessAnalysisResult {
  objectsCreated: number;
  objectsReused: number;
  originsCreated: number;
  relationshipsCreated: number;
  warnings: string[];
}

export interface MemoryObjectDetail {
  object: MemoryObjectRow;
  origins: OriginRow[];
  relationships: RelationshipRow[];
}

export interface MemoryObjectListResult {
  objects: MemoryObjectRow[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface ConversationObjectsResult {
  conversationId: string;
  objects: MemoryObjectRow[];
  relationships: RelationshipRow[];
}

export interface MemoryServiceDeps {
  memory: MemoryRepository;
  logger?: {
    info?: (context: Record<string, unknown>, message: string) => void;
    warn: (context: Record<string, unknown>, message: string) => void;
    error: (context: Record<string, unknown>, message: string) => void;
  };
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class MemoryService {
  constructor(private readonly deps: MemoryServiceDeps) {}

  // =========================================================================
  // Write path — process an analysis into the memory graph
  // =========================================================================

  /**
   * Process a Phase 1 analysis into the memory graph.
   *
   * Idempotent within reason: re-processing the same analysis will resolve to
   * existing objects and skip duplicate origins/relationships.
   */
  async processAnalysis(input: ProcessAnalysisInput): Promise<ProcessAnalysisResult> {
    const warnings: string[] = [];
    let objectsCreated = 0;
    let objectsReused = 0;
    let originsCreated = 0;
    let relationshipsCreated = 0;

    // --- 1. Build candidates from the analysis ----------------------------
    const {
      objects: candidates,
      relationships: candidateRels,
      warnings: builderWarnings,
    } = buildConnections(input.analysis);

    // Surface builder warnings (V2 validation drops forbidden types here)
    warnings.push(...builderWarnings);

    if (candidates.length === 0) {
      this.deps.logger?.info?.(
        { conversationId: input.conversationId },
        'no memory objects to create from analysis',
      );
      return { objectsCreated, objectsReused, originsCreated, relationshipsCreated, warnings };
    }

    // --- 2. Validate candidates -------------------------------------------
    // V2: also enforce forbidden-type guard (belt-and-suspenders after builder)
    const validObjects: CandidateMemoryObject[] = [];
    for (let i = 0; i < candidates.length; i++) {
      const cand = candidates[i];
      if (!cand) continue;

      // Forbidden type check (catches any types that slipped through builder)
      const forbiddenErrors = validateObjectTypeAllowed(cand.type, i);
      if (forbiddenErrors.length > 0) {
        warnings.push(`Skipped object "${cand.name}": ${forbiddenErrors.map((e: ValidationError) => e.message).join(', ')}`);
        continue;
      }

      const errors = validateObject(
        { type: cand.type, name: cand.name, confidence: cand.confidence },
        i,
      );
      if (errors.length > 0) {
        warnings.push(`Skipped object "${cand.name}": ${errors.map((e: ValidationError) => e.message).join(', ')}`);
        continue;
      }
      validObjects.push(cand);
    }

    // --- 3. Resolve and create/reuse objects -------------------------------
    // Map tempId → actual database id for relationship wiring.
    const tempIdToDbId = new Map<string, string>();

    for (const candidate of validObjects) {
      const normalizedN = normalizeName(candidate.name);
      const normalizedT = normalizeType(candidate.type);

      // Check if this object already exists in the database.
      const existing = await this.deps.memory.findByTypeAndName(normalizedT, normalizedN);

      if (existing) {
        // Reuse: bump lastSeenAt and mentionCount.
        tempIdToDbId.set(candidate.tempId, existing.id);
        await this.deps.memory.updateObjectSeen(existing.id);

        // Merge any new attributes.
        if (candidate.attributes && Object.keys(candidate.attributes).length > 0) {
          await this.deps.memory.mergeAttributes(existing.id, candidate.attributes);
        }

        objectsReused++;
      } else {
        // Create a new memory object.
        const created = await this.deps.memory.createObject({
          type: normalizedT,
          name: candidate.name,
          normalizedName: normalizedN,
          attributes: candidate.attributes,
        });
        tempIdToDbId.set(candidate.tempId, created.id);
        objectsCreated++;
      }
    }

    // --- 4. Create origin connections (🔴 RED) ----------------------------
    for (const candidate of validObjects) {
      const dbId = tempIdToDbId.get(candidate.tempId);
      if (!dbId) continue;

      const dbEntityId = candidate.sourceEntityId
        ? input.entityIds?.[candidate.sourceEntityId] ?? null
        : null;
      const dbItemId = candidate.sourceItemId
        ? input.itemIds?.[candidate.sourceItemId] ?? null
        : null;

      await this.deps.memory.createOrigin({
        objectId: dbId,
        conversationId: input.conversationId,
        analysisId: input.analysisId,
        sourceEntityId: dbEntityId,
        sourceItemId: dbItemId,
        originType: 'extracted',
        confidence: candidate.confidence,
      });
      originsCreated++;
    }

    // --- 5. Validate and create relationships (⚫ BLACK) ------------------
    // Build the valid object keys set from temp ids that were successfully resolved.
    const validObjectKeys = new Set(tempIdToDbId.keys());

    // Build type lookup for Connection Matrix validation
    const tempIdToType = new Map<string, string>();
    for (const obj of validObjects) {
      if (tempIdToDbId.has(obj.tempId)) {
        tempIdToType.set(obj.tempId, obj.type);
      }
    }

    // Validate relationships — legacy validation + Connection Matrix (V2)
    const validRels: CandidateRelationship[] = [];
    for (let i = 0; i < candidateRels.length; i++) {
      const rel = candidateRels[i];
      if (!rel) continue;

      // Basic structural validation
      const errors = validateRelationship(
        {
          source: rel.sourceTempId,
          target: rel.targetTempId,
          type: rel.relationshipType,
          confidence: rel.confidence,
        },
        i,
        validObjectKeys,
      );
      if (errors.length > 0) {
        warnings.push(
          `Skipped relationship ${rel.sourceTempId} → ${rel.targetTempId}: ${errors.map((e: ValidationError) => e.message).join(', ')}`,
        );
        continue;
      }

      // Connection Matrix validation (V2)
      const sourceType = tempIdToType.get(rel.sourceTempId);
      const targetType = tempIdToType.get(rel.targetTempId);
      if (sourceType && targetType) {
        const matrixResult = validateConnectionRelationship(
          sourceType,
          targetType,
          rel.relationshipType,
          rel.confidence,
        );
        if (!matrixResult.accepted) {
          warnings.push(
            `Skipped relationship (Connection Matrix): ${rel.sourceTempId} → ${rel.targetTempId}: ${matrixResult.rejectionReason}`,
          );
          continue;
        }
      }

      validRels.push(rel);
    }

    // Remove duplicates within the batch.
    const dupIndices = findDuplicateRelationships(
      validRels.map((r) => ({
        source: r.sourceTempId,
        target: r.targetTempId,
        type: r.relationshipType,
      })),
    );
    const dedupedRels = validRels.filter((_, i) => !dupIndices.includes(i));

    // Persist relationships (upsert prevents DB-level duplicates too).
    // V2: store evidence text in attributes.evidence.
    for (const rel of dedupedRels) {
      const sourceDbId = tempIdToDbId.get(rel.sourceTempId);
      const targetDbId = tempIdToDbId.get(rel.targetTempId);
      if (!sourceDbId || !targetDbId) continue;

      // Final guard: no self-referencing.
      if (sourceDbId === targetDbId) continue;

      try {
        await this.deps.memory.upsertRelationship({
          sourceObjectId: sourceDbId,
          targetObjectId: targetDbId,
          relationshipType: rel.relationshipType,
          confidence: rel.confidence,
          sourceConversationId: input.conversationId,
          // V2: persist evidence text so the source of the relationship is traceable
          attributes: rel.evidence ? { evidence: rel.evidence } : undefined,
        });
        relationshipsCreated++;
      } catch (error) {
        warnings.push(
          `Failed to create relationship ${rel.sourceTempId} → ${rel.targetTempId}: ${String(error)}`,
        );
      }
    }

    this.deps.logger?.info?.(
      {
        conversationId: input.conversationId,
        objectsCreated,
        objectsReused,
        originsCreated,
        relationshipsCreated,
        warnings: warnings.length,
      },
      'memory graph updated',
    );

    return { objectsCreated, objectsReused, originsCreated, relationshipsCreated, warnings };
  }

  // =========================================================================
  // Read path — API operations
  // =========================================================================

  /** Get a single memory object with its origins and relationships. */
  async getObject(id: string): Promise<MemoryObjectDetail | null> {
    const object = await this.deps.memory.findObjectById(id);
    if (!object) return null;

    const [origins, relationships] = await Promise.all([
      this.deps.memory.findOriginsByObject(id),
      this.deps.memory.findRelationshipsByObject(id),
    ]);

    return { object, origins, relationships };
  }

  /** Paginated object listing with optional type and name search filters. */
  async listObjects(filters: {
    type?: string;
    search?: string;
    page: number;
    limit: number;
  }): Promise<MemoryObjectListResult> {
    const [objects, total] = await Promise.all([
      this.deps.memory.listObjects(filters),
      this.deps.memory.countObjects({ type: filters.type, search: filters.search }),
    ]);

    return {
      objects,
      pagination: {
        page: filters.page,
        limit: filters.limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / filters.limit)),
      },
    };
  }

  /** Get all relationships for an object. */
  async getObjectRelationships(objectId: string): Promise<RelationshipRow[]> {
    return this.deps.memory.findRelationshipsByObject(objectId);
  }

  /** Get all memory objects originating from a conversation. */
  async getConversationObjects(conversationId: string): Promise<ConversationObjectsResult> {
    const objects = await this.deps.memory.findObjectsByConversation(conversationId);

    // Collect all relationships between the conversation's objects.
    const objectIds = new Set(objects.map((o) => o.id));
    const allRels: RelationshipRow[] = [];
    for (const obj of objects) {
      const rels = await this.deps.memory.findRelationshipsByObject(obj.id);
      for (const rel of rels) {
        // Only include relationships where both ends are from this conversation.
        if (objectIds.has(rel.sourceObjectId) && objectIds.has(rel.targetObjectId)) {
          // Prevent duplicates.
          if (!allRels.some((r) => r.id === rel.id)) {
            allRels.push(rel);
          }
        }
      }
    }

    return { conversationId, objects, relationships: allRels };
  }
}
