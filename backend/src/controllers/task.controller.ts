/**
 * Task and reminder controllers.
 *
 * The split is deliberate and mirrors the product rule:
 *   - a TASK is the user's to complete, so it can be ticked and un-ticked;
 *   - a REMINDER is Lifelog's promise to speak at a time, so the user does not
 *     tick it off and cannot delete it. It is only ever marked notified, or
 *     cancelled explicitly.
 */
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AppError } from '../errors/app-error.js';
import type { ActionItemRepository, ActionRecord } from '../repositories/action-item.repository.js';
import {
  UpdateReminderRequestSchema,
  UpdateTaskRequestSchema,
  type ActionItem,
  type ActionListResponse,
} from '../schemas/api.schema.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requireId(request: FastifyRequest): string {
  const { id } = request.params as { id?: string };
  if (!id || !UUID.test(id)) {
    throw AppError.validation([{ path: 'id', message: 'id must be a UUID' }]);
  }
  return id;
}

function toResponse(records: ActionRecord[], doneStatuses: string[]): ActionListResponse {
  return {
    items: records as ActionItem[],
    counts: {
      open: records.filter((record) => !doneStatuses.includes(record.status)).length,
      done: records.filter((record) => doneStatuses.includes(record.status)).length,
      total: records.length,
    },
  };
}

export class TaskController {
  constructor(private readonly actions: ActionItemRepository) {}

  list = async (_request: FastifyRequest, reply: FastifyReply): Promise<ActionListResponse> => {
    const records = await this.actions.list('TASK');
    reply.code(200);
    return toResponse(records, ['DONE', 'CANCELLED']);
  };

  update = async (request: FastifyRequest, reply: FastifyReply): Promise<{ ok: true }> => {
    const id = requireId(request);
    const parsed = UpdateTaskRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      throw AppError.validation(
        parsed.error.issues.map((issue) => ({
          path: issue.path.join('.') || 'body',
          message: issue.message,
        })),
      );
    }

    const updated = await this.actions.setTaskStatus(id, parsed.data.status);
    if (!updated) throw new AppError('NOT_FOUND', `no task with id ${id}`);

    reply.code(200);
    return { ok: true };
  };
}

export class ReminderController {
  constructor(private readonly actions: ActionItemRepository) {}

  list = async (_request: FastifyRequest, reply: FastifyReply): Promise<ActionListResponse> => {
    const records = await this.actions.list('REMINDER');
    reply.code(200);
    return toResponse(records, ['NOTIFIED', 'CANCELLED']);
  };

  /**
   * Records that a reminder has fired. There is no delete route on purpose:
   * the user asked to be reminded, and silently dropping that would break the
   * only promise Lifelog makes.
   */
  update = async (request: FastifyRequest, reply: FastifyReply): Promise<{ ok: true }> => {
    const id = requireId(request);
    const parsed = UpdateReminderRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      throw AppError.validation(
        parsed.error.issues.map((issue) => ({
          path: issue.path.join('.') || 'body',
          message: issue.message,
        })),
      );
    }

    const updated = await this.actions.markReminderNotified(id);
    if (!updated) throw new AppError('NOT_FOUND', `no reminder with id ${id}`);

    reply.code(200);
    return { ok: true };
  };
}
