import type { FastifyInstance } from 'fastify';
import type { AppDatabase } from './db.js';
import { registerPageRoutes } from './page-routes.js';
import { registerWritingFlowRoutes } from './writing-flow-routes.js';
import { registerCanvasRoutes } from './canvas-routes.js';
import { registerDocumentRoutes } from './document-routes.js';
import { ownerForToken, sessionFromCookie } from './auth.js';
import {
  LibraryError, readLibrary, createFolder, updateFolder, deleteFolder,
  createNote, updateNote, deleteNote
} from './library.js';

export function registerLibraryRoutes(app: FastifyInstance, db: AppDatabase): void {
  // All routes in this encapsulated plugin require a valid owner session.
  app.addHook('preHandler', async (request, reply) => {
    const owner = ownerForToken(db, sessionFromCookie(request.headers.cookie));
    if (!owner) return reply.code(401).send({ error: 'Authentication required' });
  });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof LibraryError) {
      return reply.code(error.status).send({ error: error.message });
    }
    // Do not expose SQLite details, stack traces, or internal errors to clients.
    app.log.error(error);
    return reply.code(500).send({ error: 'Internal server error' });
  });

  registerPageRoutes(app, db);
  registerWritingFlowRoutes(app,db);
  registerCanvasRoutes(app, db);
  registerDocumentRoutes(app, db);

  app.get('/library', async (_request, reply) => {
    reply.header('Cache-Control', 'no-store');
    return readLibrary(db);
  });

  app.post('/folders', async (request, reply) =>
    reply.code(201).send({ folder: createFolder(db, request.body) }));
  app.patch<{ Params: { id: string } }>('/folders/:id', async (request) =>
    ({ folder: updateFolder(db, request.params.id, request.body) }));
  app.delete<{ Params: { id: string } }>('/folders/:id', async (request, reply) => {
    deleteFolder(db, request.params.id);
    return reply.code(204).send();
  });

  app.post('/notes', async (request, reply) =>
    reply.code(201).send({ note: createNote(db, request.body) }));
  app.patch<{ Params: { id: string } }>('/notes/:id', async (request) =>
    ({ note: updateNote(db, request.params.id, request.body) }));
  app.delete<{ Params: { id: string } }>('/notes/:id', async (request, reply) => {
    deleteNote(db, request.params.id);
    return reply.code(204).send();
  });
}
