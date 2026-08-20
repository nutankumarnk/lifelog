/**
 * Task and reminder routes.
 *
 * Reminders have no DELETE route by design — see task.controller.ts.
 */
import type { FastifyInstance } from 'fastify';
import type { ReminderController, TaskController } from '../controllers/task.controller.js';

export interface ActionRoutesOptions {
  tasks: TaskController;
  reminders: ReminderController;
}

export async function registerActionRoutes(
  app: FastifyInstance,
  options: ActionRoutesOptions,
): Promise<void> {
  app.get('/api/v1/tasks', options.tasks.list);
  app.patch('/api/v1/tasks/:id', options.tasks.update);

  app.get('/api/v1/reminders', options.reminders.list);
  app.patch('/api/v1/reminders/:id', options.reminders.update);
}
