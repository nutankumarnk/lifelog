/**
 * Note controller.
 *
 * The HTTP-shaped edge of the Notes API: validate input, call the service, and
 * shape the response. No business rules, no SQL.
 *
 * Notes are the user-facing name for conversations — every conversation is a
 * note, the permanent lifelog record.
 */
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AppError } from '../errors/app-error.js';
import {
  NoteListQuerySchema,
  UpdateNoteRequestSchema,
  type NoteListResponse,
  type NoteDetail,
} from '../schemas/api.schema.js';
import type { ConversationService } from '../services/conversation.service.js';

/** Pre-compiled UUID regex; re-using avoids construction cost on every request. */
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class NoteController {
  constructor(private readonly service: ConversationService) {}

  /**
   * GET /api/v1/notes
   *
   * Paginated listing with optional date range, source, and search filters.
   * Returns notes ordered by newest first.
   */
  list = async (request: FastifyRequest, reply: FastifyReply): Promise<NoteListResponse> => {
    const parsed = NoteListQuerySchema.safeParse(request.query);

    if (!parsed.success) {
      const details = parsed.error.issues.map((issue) => ({
        path: issue.path.join('.') || 'query',
        message: issue.message,
      }));
      throw AppError.validation(details);
    }

    const result = await this.service.listNotes(parsed.data);
    return result;
  };

  /**
   * GET /api/v1/notes/:id
   *
   * Returns the full note with its extracted objects and relationships.
   * The note is the origin — every extracted object traces back to it.
   */
  getById = async (request: FastifyRequest, reply: FastifyReply): Promise<NoteDetail> => {
    const params = request.params as { id?: string };
    const id = params.id;

    if (!id) {
      throw AppError.validation([{ path: 'id', message: 'note id is required' }]);
    }

    if (!UUID_REGEX.test(id)) {
      throw AppError.validation([{ path: 'id', message: 'note id must be a valid UUID' }]);
    }

    const note = await this.service.getNote(id);

    if (!note) {
      throw new AppError('NOT_FOUND', `note ${id} not found`);
    }

    return note;
  };

  /**
   * PATCH /api/v1/notes/:id
   *
   * Updates the note's personalized journal entry (title, polished prose, mood, highlights).
   */
  update = async (request: FastifyRequest, reply: FastifyReply): Promise<NoteDetail> => {
    const params = request.params as { id?: string };
    const id = params.id;

    if (!id) {
      throw AppError.validation([{ path: 'id', message: 'note id is required' }]);
    }

    if (!UUID_REGEX.test(id)) {
      throw AppError.validation([{ path: 'id', message: 'note id must be a valid UUID' }]);
    }

    const parsed = UpdateNoteRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      const details = parsed.error.issues.map((issue) => ({
        path: issue.path.join('.') || 'body',
        message: issue.message,
      }));
      throw AppError.validation(details);
    }

    const updated = await this.service.updateNote(id, parsed.data);
    if (!updated) {
      throw new AppError('NOT_FOUND', `note ${id} not found`);
    }

    reply.code(200);
    return updated;
  };

  /** DELETE /api/v1/notes/:id */
  delete = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const params = request.params as { id?: string };
    const id = params.id;

    if (!id) {
      throw AppError.validation([{ path: 'id', message: 'note id is required' }]);
    }

    if (!UUID_REGEX.test(id)) {
      throw AppError.validation([{ path: 'id', message: 'note id must be a valid UUID' }]);
    }

    const deleted = await this.service.deleteNote(id);
    if (!deleted) {
      throw new AppError('NOT_FOUND', `note ${id} not found`);
    }

    reply.code(204).send();
  };
}
