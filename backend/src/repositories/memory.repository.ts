/**
 * Memory persistence.
 *
 * Every SQL statement for the Phase 2 memory graph lives in this file:
 * memory_objects, object_origins, and object_relationships.
 *
 * Services call methods here; they never build queries, and they never see a
 * Drizzle type.
 */
import { and, desc, eq, ilike, inArray, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import {
  memoryObjects,
  objectOrigins,
  objectRelationships,
} from '../db/schema.js';

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

export interface NewMemoryObject {
  userId?: string | null;
  type: string;
  name: string;
  normalizedName: string;
  attributes?: Record<string, unknown>;
}

export interface NewOrigin {
  objectId: string;
  conversationId: string;
  analysisId?: string | null;
  sourceEntityId?: string | null;
  sourceItemId?: string | null;
  originType?: string;
  confidence?: number;
}

export interface NewRelationship {
  userId?: string | null;
  sourceObjectId: string;
  targetObjectId: string;
  relationshipType: string;
  confidence?: number;
  sourceConversationId: string;
  attributes?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

export interface MemoryObjectRow {
  id: string;
  type: string;
  name: string;
  normalizedName: string;
  attributes: Record<string, unknown>;
  mentionCount: number;
  firstSeenAt: Date;
  lastSeenAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface OriginRow {
  id: string;
  objectId: string;
  conversationId: string;
  analysisId: string | null;
  sourceEntityId: string | null;
  sourceItemId: string | null;
  originType: string;
  confidence: number;
  createdAt: Date;
}

export interface RelationshipRow {
  id: string;
  sourceObjectId: string;
  targetObjectId: string;
  relationshipType: string;
  confidence: number;
  sourceConversationId: string;
  attributes: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

export class MemoryRepository {
  constructor(private readonly db: Database) {}

  // --- Memory objects ------------------------------------------------------

  /** Find an existing object by type and normalised name (for resolution). */
  async findByTypeAndName(
    type: string,
    normalizedName: string,
    userId?: string | null,
  ): Promise<MemoryObjectRow | null> {
    const conditions = [
      eq(memoryObjects.type, type),
      eq(memoryObjects.normalizedName, normalizedName),
    ];
    // Phase 1/2: userId is always null. Include it for forward compatibility.
    if (userId) {
      conditions.push(eq(memoryObjects.userId, userId));
    }

    const [row] = await this.db
      .select({
        id: memoryObjects.id,
        type: memoryObjects.type,
        name: memoryObjects.name,
        normalizedName: memoryObjects.normalizedName,
        attributes: memoryObjects.attributes,
        mentionCount: memoryObjects.mentionCount,
        firstSeenAt: memoryObjects.firstSeenAt,
        lastSeenAt: memoryObjects.lastSeenAt,
        createdAt: memoryObjects.createdAt,
        updatedAt: memoryObjects.updatedAt,
      })
      .from(memoryObjects)
      .where(and(...conditions))
      .limit(1);

    return row ?? null;
  }

  /** Create a new memory object. */
  async createObject(input: NewMemoryObject): Promise<MemoryObjectRow> {
    const [row] = await this.db
      .insert(memoryObjects)
      .values({
        userId: input.userId ?? null,
        type: input.type,
        name: input.name,
        normalizedName: input.normalizedName,
        attributes: input.attributes ?? {},
      })
      .returning({
        id: memoryObjects.id,
        type: memoryObjects.type,
        name: memoryObjects.name,
        normalizedName: memoryObjects.normalizedName,
        attributes: memoryObjects.attributes,
        mentionCount: memoryObjects.mentionCount,
        firstSeenAt: memoryObjects.firstSeenAt,
        lastSeenAt: memoryObjects.lastSeenAt,
        createdAt: memoryObjects.createdAt,
        updatedAt: memoryObjects.updatedAt,
      });

    if (!row) throw new Error('memory object insert returned no row');
    return row;
  }

  /** Bump lastSeenAt and mentionCount for an existing object. */
  async updateObjectSeen(id: string): Promise<void> {
    await this.db
      .update(memoryObjects)
      .set({
        lastSeenAt: new Date(),
        updatedAt: new Date(),
        mentionCount: sql`${memoryObjects.mentionCount} + 1`,
      })
      .where(eq(memoryObjects.id, id));
  }

  /** Merge attributes into an existing object (additive, not destructive). */
  async mergeAttributes(id: string, newAttributes: Record<string, unknown>): Promise<void> {
    if (Object.keys(newAttributes).length === 0) return;
    await this.db
      .update(memoryObjects)
      .set({
        attributes: sql`${memoryObjects.attributes} || ${JSON.stringify(newAttributes)}::jsonb`,
        updatedAt: new Date(),
      })
      .where(eq(memoryObjects.id, id));
  }

  /** Find a single object by id. */
  async findObjectById(id: string): Promise<MemoryObjectRow | null> {
    const [row] = await this.db
      .select({
        id: memoryObjects.id,
        type: memoryObjects.type,
        name: memoryObjects.name,
        normalizedName: memoryObjects.normalizedName,
        attributes: memoryObjects.attributes,
        mentionCount: memoryObjects.mentionCount,
        firstSeenAt: memoryObjects.firstSeenAt,
        lastSeenAt: memoryObjects.lastSeenAt,
        createdAt: memoryObjects.createdAt,
        updatedAt: memoryObjects.updatedAt,
      })
      .from(memoryObjects)
      .where(eq(memoryObjects.id, id))
      .limit(1);

    return row ?? null;
  }

  /** Paginated object listing with optional type and name search filters. */
  async listObjects(filters: {
    type?: string;
    search?: string;
    page: number;
    limit: number;
  }): Promise<MemoryObjectRow[]> {
    const conditions: ReturnType<typeof eq>[] = [];
    if (filters.type) {
      conditions.push(eq(memoryObjects.type, filters.type));
    }
    if (filters.search) {
      conditions.push(ilike(memoryObjects.name, `%${filters.search}%`));
    }

    const offset = (filters.page - 1) * filters.limit;

    return this.db
      .select({
        id: memoryObjects.id,
        type: memoryObjects.type,
        name: memoryObjects.name,
        normalizedName: memoryObjects.normalizedName,
        attributes: memoryObjects.attributes,
        mentionCount: memoryObjects.mentionCount,
        firstSeenAt: memoryObjects.firstSeenAt,
        lastSeenAt: memoryObjects.lastSeenAt,
        createdAt: memoryObjects.createdAt,
        updatedAt: memoryObjects.updatedAt,
      })
      .from(memoryObjects)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(memoryObjects.lastSeenAt))
      .limit(filters.limit)
      .offset(offset);
  }

  /** Count objects matching filters, for pagination. */
  async countObjects(filters: { type?: string; search?: string }): Promise<number> {
    const conditions: ReturnType<typeof eq>[] = [];
    if (filters.type) conditions.push(eq(memoryObjects.type, filters.type));
    if (filters.search) conditions.push(ilike(memoryObjects.name, `%${filters.search}%`));

    const [row] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(memoryObjects)
      .where(conditions.length > 0 ? and(...conditions) : undefined);

    return row?.count ?? 0;
  }

  // --- Origins (🔴 RED) ---------------------------------------------------

  /** Create an origin connection (object ← conversation). */
  async createOrigin(input: NewOrigin): Promise<OriginRow> {
    const [row] = await this.db
      .insert(objectOrigins)
      .values({
        objectId: input.objectId,
        conversationId: input.conversationId,
        analysisId: input.analysisId ?? null,
        sourceEntityId: input.sourceEntityId ?? null,
        sourceItemId: input.sourceItemId ?? null,
        originType: input.originType ?? 'extracted',
        confidence: input.confidence ?? 0.5,
      })
      .onConflictDoNothing({
        target: [objectOrigins.objectId, objectOrigins.conversationId],
      })
      .returning({
        id: objectOrigins.id,
        objectId: objectOrigins.objectId,
        conversationId: objectOrigins.conversationId,
        analysisId: objectOrigins.analysisId,
        sourceEntityId: objectOrigins.sourceEntityId,
        sourceItemId: objectOrigins.sourceItemId,
        originType: objectOrigins.originType,
        confidence: objectOrigins.confidence,
        createdAt: objectOrigins.createdAt,
      });

    // onConflictDoNothing may return nothing if the origin already exists.
    return row ?? ({} as OriginRow);
  }

  /** Find all origins for an object. */
  async findOriginsByObject(objectId: string): Promise<OriginRow[]> {
    return this.db
      .select({
        id: objectOrigins.id,
        objectId: objectOrigins.objectId,
        conversationId: objectOrigins.conversationId,
        analysisId: objectOrigins.analysisId,
        sourceEntityId: objectOrigins.sourceEntityId,
        sourceItemId: objectOrigins.sourceItemId,
        originType: objectOrigins.originType,
        confidence: objectOrigins.confidence,
        createdAt: objectOrigins.createdAt,
      })
      .from(objectOrigins)
      .where(eq(objectOrigins.objectId, objectId))
      .orderBy(desc(objectOrigins.createdAt));
  }

  /** Find all objects originating from a conversation. */
  async findObjectsByConversation(conversationId: string): Promise<MemoryObjectRow[]> {
    return this.db
      .select({
        id: memoryObjects.id,
        type: memoryObjects.type,
        name: memoryObjects.name,
        normalizedName: memoryObjects.normalizedName,
        attributes: memoryObjects.attributes,
        mentionCount: memoryObjects.mentionCount,
        firstSeenAt: memoryObjects.firstSeenAt,
        lastSeenAt: memoryObjects.lastSeenAt,
        createdAt: memoryObjects.createdAt,
        updatedAt: memoryObjects.updatedAt,
      })
      .from(memoryObjects)
      .innerJoin(objectOrigins, eq(objectOrigins.objectId, memoryObjects.id))
      .where(eq(objectOrigins.conversationId, conversationId))
      .orderBy(memoryObjects.name);
  }

  // --- Relationships (⚫ BLACK) --------------------------------------------

  /**
   * Create or update a relationship. If the same (source, target, type)
   * already exists, update the confidence (take the higher one) and bump
   * updatedAt. This prevents duplicate relationships.
   */
  async upsertRelationship(input: NewRelationship): Promise<RelationshipRow> {
    const [row] = await this.db
      .insert(objectRelationships)
      .values({
        userId: input.userId ?? null,
        sourceObjectId: input.sourceObjectId,
        targetObjectId: input.targetObjectId,
        relationshipType: input.relationshipType,
        confidence: input.confidence ?? 0.5,
        sourceConversationId: input.sourceConversationId,
        attributes: input.attributes ?? {},
      })
      .onConflictDoUpdate({
        target: [
          objectRelationships.sourceObjectId,
          objectRelationships.targetObjectId,
          objectRelationships.relationshipType,
        ],
        set: {
          confidence: sql`GREATEST(${objectRelationships.confidence}, EXCLUDED.confidence)`,
          updatedAt: new Date(),
          sourceConversationId: input.sourceConversationId,
        },
      })
      .returning({
        id: objectRelationships.id,
        sourceObjectId: objectRelationships.sourceObjectId,
        targetObjectId: objectRelationships.targetObjectId,
        relationshipType: objectRelationships.relationshipType,
        confidence: objectRelationships.confidence,
        sourceConversationId: objectRelationships.sourceConversationId,
        attributes: objectRelationships.attributes,
        createdAt: objectRelationships.createdAt,
        updatedAt: objectRelationships.updatedAt,
      });

    if (!row) throw new Error('relationship upsert returned no row');
    return row;
  }

  /** Find all relationships for an object (both directions). */
  async findRelationshipsByObject(objectId: string): Promise<RelationshipRow[]> {
    return this.db
      .select({
        id: objectRelationships.id,
        sourceObjectId: objectRelationships.sourceObjectId,
        targetObjectId: objectRelationships.targetObjectId,
        relationshipType: objectRelationships.relationshipType,
        confidence: objectRelationships.confidence,
        sourceConversationId: objectRelationships.sourceConversationId,
        attributes: objectRelationships.attributes,
        createdAt: objectRelationships.createdAt,
        updatedAt: objectRelationships.updatedAt,
      })
      .from(objectRelationships)
      .where(
        sql`${objectRelationships.sourceObjectId} = ${objectId} OR ${objectRelationships.targetObjectId} = ${objectId}`,
      )
      .orderBy(desc(objectRelationships.updatedAt));
  }

  /** Find relationships whose two endpoints are both in the supplied graph. */
  async findRelationshipsBetween(objectIds: string[]): Promise<RelationshipRow[]> {
    if (objectIds.length === 0) return [];
    return this.db
      .select({
        id: objectRelationships.id,
        sourceObjectId: objectRelationships.sourceObjectId,
        targetObjectId: objectRelationships.targetObjectId,
        relationshipType: objectRelationships.relationshipType,
        confidence: objectRelationships.confidence,
        sourceConversationId: objectRelationships.sourceConversationId,
        attributes: objectRelationships.attributes,
        createdAt: objectRelationships.createdAt,
        updatedAt: objectRelationships.updatedAt,
      })
      .from(objectRelationships)
      .where(and(
        inArray(objectRelationships.sourceObjectId, objectIds),
        inArray(objectRelationships.targetObjectId, objectIds),
      ))
      .orderBy(desc(objectRelationships.updatedAt));
  }
}
