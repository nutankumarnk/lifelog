/**
 * Note routes.
 *
 * Notes are the user-facing name for conversations — the permanent lifelog
 * record. Every conversation is a note; these routes provide read and
 * user-initiated management access.
 *
 * Routes declare paths and hand off. Any logic beyond that belongs in a
 * controller or a service — see docs/coding-structure.md.
 */
import type { FastifyInstance } from 'fastify';
import type { NoteController } from '../controllers/note.controller.js';

export interface NoteRoutesOptions {
  controller: NoteController;
}

export async function registerNoteRoutes(
  app: FastifyInstance,
  options: NoteRoutesOptions,
): Promise<void> {
  app.get('/api/v1/notes', options.controller.list);
  app.get('/api/v1/notes/:id', options.controller.getById);
  app.patch('/api/v1/notes/:id', options.controller.update);
  app.delete('/api/v1/notes/:id', options.controller.delete);
}
