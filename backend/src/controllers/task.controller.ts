/**
 * Task controller.
 *
 * Lists the tasks and reminders Lifelog extracted, and records completion.
 * Validation and shaping only — the repository owns the SQL.
 */
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AppError } from '../errors/app-error.js';
import type { TaskRepository } from '../repositories/task.repository.js';
import {
  TaskListQuerySchema,
  UpdateTaskRequestSchema,
  type TaskListResponse,
  type TaskItem,
} from '../schemas/api.schema.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class TaskController {
  constructor(private readonly tasks: TaskRepository) {}

  list = async (request: FastifyRequest, reply: FastifyReply): Promise<TaskListResponse> => {
    const parsed = TaskListQuerySchema.safeParse(request.query ?? {});
    if (!parsed.success) {
      throw AppError.validation(
        parsed.error.issues.map((issue) => ({
          path: issue.path.join('.') || 'query',
          message: issue.message,
        })),
      );
    }

    const all = await this.tasks.list({ limit: parsed.data.limit });
    const filtered = parsed.data.status
      ? all.filter((item) => item.status === parsed.data.status)
      : all;

    reply.code(200);
    return {
      items: filtered as TaskItem[],
      counts: {
        open: all.filter((item) => item.status === 'OPEN' || item.status === 'IN_PROGRESS').length,
        done: all.filter((item) => item.status === 'DONE').length,
        total: all.length,
      },
    };
  };

  update = async (request: FastifyRequest, reply: FastifyReply): Promise<TaskItem> => {
    const { id } = request.params as { id?: string };
    if (!id || !UUID.test(id)) {
      throw AppError.validation([{ path: 'id', message: 'id must be a UUID' }]);
    }

    const parsed = UpdateTaskRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      throw AppError.validation(
        parsed.error.issues.map((issue) => ({
          path: issue.path.join('.') || 'body',
          message: issue.message,
        })),
      );
    }

    const updated = await this.tasks.setStatus(id, parsed.data.status);
    if (!updated) {
      throw new AppError('NOT_FOUND', `no task or reminder with id ${id}`);
    }

    reply.code(200);
    return updated as TaskItem;
  };
}
