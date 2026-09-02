/**
 * Memory controller.
 *
 * The HTTP layer for the Phase 2 Memory Graph API:
 *   - GET /api/v1/memory/objects — list objects (paginated, filterable)
 *   - GET /api/v1/memory/objects/:id — object detail with origins and relationships
 *   - GET /api/v1/memory/objects/:id/relationships — connected objects
 *   - GET /api/v1/memory/conversations/:id — objects and relationships from a conversation
 *   - POST /api/v1/memory/process — process an existing conversation into the memory graph
 *
 * Contains validation and response shaping only. No business rules, no SQL.
 */
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AppError } from '../errors/app-error.js';
import {
  MemoryObjectListQuerySchema,
  type MemoryObjectListResponse,
  type MemoryObjectDetail,
  type ConversationObjects,
  type ObjectRelationshipApi,
} from '../schemas/api.schema.js';
import type { MemoryService } from '../services/memory.service.js';
import type { AnalysisRepository } from '../repositories/analysis.repository.js';
import { z } from 'zod';

const ProcessMemoryBodySchema = z.object({
  conversationId: z.string().uuid(),
});

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class MemoryController {
  constructor(
    private readonly service: MemoryService,
    private readonly analyses?: AnalysisRepository,
  ) {}

  /**
   * GET /api/v1/memory/objects
   *
   * Paginated listing of memory objects with optional type and search filters.
   */
  listObjects = async (
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<MemoryObjectListResponse> => {
    const parsed = MemoryObjectListQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      const details = parsed.error.issues.map((issue: { path: Array<string | number>; message: string }) => ({
        path: issue.path.join('.') || 'query',
        message: issue.message,
      }));
      throw AppError.validation(details);
    }

    const result = await this.service.listObjects(parsed.data);

    reply.code(200);
    return {
      objects: result.objects.map((obj) => ({
        id: obj.id,
        type: obj.type,
        name: obj.name,
        attributes: obj.attributes,
        mention_count: obj.mentionCount,
        first_seen_at: obj.firstSeenAt.toISOString(),
        last_seen_at: obj.lastSeenAt.toISOString(),
        created_at: obj.createdAt.toISOString(),
        updated_at: obj.updatedAt.toISOString(),
      })),
      pagination: {
        page: result.pagination.page,
        limit: result.pagination.limit,
        total: result.pagination.total,
        total_pages: result.pagination.totalPages,
      },
    };
  };

  /**
   * GET /api/v1/memory/objects/:id
   *
   * Returns a memory object with its 🔴 origin connections and ⚫ relationships.
   */
  getObjectById = async (
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<MemoryObjectDetail> => {
    const { id } = request.params as { id: string };

    if (!id || !UUID_REGEX.test(id)) {
      throw AppError.validation([{ path: 'id', message: 'id must be a valid UUID' }]);
    }

    const detail = await this.service.getObject(id);
    if (!detail) {
      throw new AppError('NOT_FOUND', `memory object ${id} not found`);
    }

    reply.code(200);
    return {
      id: detail.object.id,
      type: detail.object.type,
      name: detail.object.name,
      attributes: detail.object.attributes,
      mention_count: detail.object.mentionCount,
      first_seen_at: detail.object.firstSeenAt.toISOString(),
      last_seen_at: detail.object.lastSeenAt.toISOString(),
      created_at: detail.object.createdAt.toISOString(),
      updated_at: detail.object.updatedAt.toISOString(),
      origins: detail.origins.map((origin) => ({
        id: origin.id,
        conversation_id: origin.conversationId,
        analysis_id: origin.analysisId,
        origin_type: origin.originType,
        confidence: origin.confidence,
        created_at: origin.createdAt.toISOString(),
      })),
      relationships: detail.relationships.map((rel) => ({
        id: rel.id,
        source_object_id: rel.sourceObjectId,
        target_object_id: rel.targetObjectId,
        relationship_type: rel.relationshipType,
        confidence: rel.confidence,
        source_conversation_id: rel.sourceConversationId,
        attributes: rel.attributes,
        created_at: rel.createdAt.toISOString(),
        updated_at: rel.updatedAt.toISOString(),
      })),
    };
  };

  /**
   * GET /api/v1/memory/objects/:id/relationships
   *
   * Returns all connected relationships for a single memory object.
   */
  getObjectRelationships = async (
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<{ relationships: ObjectRelationshipApi[] }> => {
    const { id } = request.params as { id: string };

    if (!id || !UUID_REGEX.test(id)) {
      throw AppError.validation([{ path: 'id', message: 'id must be a valid UUID' }]);
    }

    const relationships = await this.service.getObjectRelationships(id);

    reply.code(200);
    return {
      relationships: relationships.map((rel) => ({
        id: rel.id,
        source_object_id: rel.sourceObjectId,
        target_object_id: rel.targetObjectId,
        relationship_type: rel.relationshipType,
        confidence: rel.confidence,
        source_conversation_id: rel.sourceConversationId,
        attributes: rel.attributes,
        created_at: rel.createdAt.toISOString(),
        updated_at: rel.updatedAt.toISOString(),
      })),
    };
  };

  /**
   * GET /api/v1/memory/conversations/:id
   *
   * Returns memory objects and relationships originating from a conversation.
   */
  getConversationObjects = async (
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<ConversationObjects> => {
    const { id } = request.params as { id: string };

    if (!id || !UUID_REGEX.test(id)) {
      throw AppError.validation([{ path: 'id', message: 'id must be a valid UUID' }]);
    }

    const result = await this.service.getConversationObjects(id);

    reply.code(200);
    return {
      conversation_id: result.conversationId,
      objects: result.objects.map((obj) => ({
        id: obj.id,
        type: obj.type,
        name: obj.name,
        attributes: obj.attributes,
        mention_count: obj.mentionCount,
        first_seen_at: obj.firstSeenAt.toISOString(),
        last_seen_at: obj.lastSeenAt.toISOString(),
        created_at: obj.createdAt.toISOString(),
        updated_at: obj.updatedAt.toISOString(),
      })),
      relationships: result.relationships.map((rel) => ({
        id: rel.id,
        source_object_id: rel.sourceObjectId,
        target_object_id: rel.targetObjectId,
        relationship_type: rel.relationshipType,
        confidence: rel.confidence,
        source_conversation_id: rel.sourceConversationId,
        attributes: rel.attributes,
        created_at: rel.createdAt.toISOString(),
        updated_at: rel.updatedAt.toISOString(),
      })),
    };
  };

  /**
   * POST /api/v1/memory/process
   *
   * Process structured conversation information into memory objects and connections.
   */
  process = async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = ProcessMemoryBodySchema.safeParse(request.body);
    if (!parsed.success) {
      const details = parsed.error.issues.map((issue) => ({
        path: issue.path.join('.') || 'body',
        message: issue.message,
      }));
      throw AppError.validation(details);
    }

    if (!this.analyses) {
      throw AppError.internal('Analysis repository not available');
    }

    const latest = await this.analyses.findLatestWithIdByConversation(parsed.data.conversationId);
    if (!latest) {
      throw new AppError('NOT_FOUND', `no analysis found for conversation ${parsed.data.conversationId}`);
    }

    const result = await this.service.processAnalysis({
      conversationId: parsed.data.conversationId,
      analysis: latest.analysis,
      analysisId: latest.analysisId,
    });

    reply.code(200);
    return result;
  };
}
