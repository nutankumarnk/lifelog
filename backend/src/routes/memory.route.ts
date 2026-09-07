/**
 * Memory routes.
 *
 * REST API for the Phase 2 memory graph:
 *   - GET /api/v1/memory/objects
 *   - GET /api/v1/memory/objects/:id
 *   - GET /api/v1/memory/objects/:id/relationships
 *   - GET /api/v1/memory/conversations/:id
 *   - POST /api/v1/memory/process
 *
 * Routes declare paths and hand off. Any logic beyond that belongs in a
 * controller or service — see docs/coding-structure.md.
 */
import type { FastifyInstance } from 'fastify';
import type { MemoryController } from '../controllers/memory.controller.js';

export interface MemoryRoutesOptions {
  controller: MemoryController;
}

export async function registerMemoryRoutes(
  app: FastifyInstance,
  options: MemoryRoutesOptions,
): Promise<void> {
  app.get('/api/v1/memory/objects', options.controller.listObjects);
  app.get('/api/v1/memory/graph', options.controller.getGraph);
  app.get('/api/v1/memory/objects/:id', options.controller.getObjectById);
  app.get('/api/v1/memory/objects/:id/relationships', options.controller.getObjectRelationships);
  app.get('/api/v1/memory/conversations/:id', options.controller.getConversationObjects);
  app.post('/api/v1/memory/process', options.controller.process);
}
