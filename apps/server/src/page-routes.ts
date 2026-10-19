import type { FastifyInstance } from 'fastify';
import type { AppDatabase } from './db.js';
import {
  getPageLayout, initializeNotePage, previewPageInsertion, insertPage,
  attachAdjacentPages, detachPageEdge, deleteLeafPage
} from './pages.js';

/** Registered inside the existing authenticated /api library plugin. */
export function registerPageRoutes(app: FastifyInstance, db: AppDatabase): void {
  app.get<{ Params: { noteId: string } }>('/notes/:noteId/pages', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    return getPageLayout(db, request.params.noteId);
  });
  app.post<{ Params: { noteId: string } }>('/notes/:noteId/pages/initialize', async (request) =>
    initializeNotePage(db, request.params.noteId, request.body));
  app.post<{ Params: { noteId: string } }>('/notes/:noteId/pages/preview', async (request) =>
    previewPageInsertion(db, request.params.noteId, request.body));
  app.post<{ Params: { noteId: string } }>('/notes/:noteId/pages/insert', async (request) =>
    insertPage(db, request.params.noteId, request.body));
  app.post<{ Params: { noteId: string } }>('/notes/:noteId/pages/link', async (request) =>
    attachAdjacentPages(db, request.params.noteId, request.body));
  app.post<{ Params: { noteId: string } }>('/notes/:noteId/pages/unlink', async (request) =>
    detachPageEdge(db, request.params.noteId, request.body));
  app.delete<{ Params: { noteId: string; pageId: string } }>('/notes/:noteId/pages/:pageId', async (request) =>
    deleteLeafPage(db, request.params.noteId, request.params.pageId, request.body));
}
