/**
 * Task routes.
 *
 * Declares paths only — see docs/coding-structure.md.
 */
import type { FastifyInstance } from 'fastify';
import type { TaskController } from '../controllers/task.controller.js';

export interface TaskRoutesOptions {
  controller: TaskController;
}

export async function registerTaskRoutes(
  app: FastifyInstance,
  options: TaskRoutesOptions,
): Promise<void> {
  app.get('/api/v1/tasks', options.controller.list);
  app.patch('/api/v1/tasks/:id', options.controller.update);
}
