/**
 * Conversation routes.
 *
 * Routes declare paths and hand off. Any logic beyond that belongs in a
 * controller or a service — see docs/coding-structure.md.
 */
import type { FastifyInstance } from 'fastify';
import type { ConversationController } from '../controllers/conversation.controller.js';

export interface ConversationRoutesOptions {
  controller: ConversationController;
}

export async function registerConversationRoutes(
  app: FastifyInstance,
  options: ConversationRoutesOptions,
): Promise<void> {
  app.post('/api/v1/conversations/analyze', options.controller.analyze);
}
