import type { FastifyInstance } from 'fastify';
import type { AppDatabase } from './db.js';
import { getWritingFlow,saveWritingFlow,appendWritingContinuation } from './writing-flows.js';

interface Params {noteId:string;pageId:string}
export function registerWritingFlowRoutes(app:FastifyInstance,db:AppDatabase) {
  app.get<{Params:Params}>('/notes/:noteId/pages/:pageId/flow',async(request,reply)=>{
    reply.header('Cache-Control','no-store');
    return getWritingFlow(db,request.params.noteId,request.params.pageId);
  });
  app.put<{Params:Params}>('/notes/:noteId/pages/:pageId/flow',async(request,reply)=>{
    reply.header('Cache-Control','no-store');
    return saveWritingFlow(db,request.params.noteId,request.params.pageId,request.body);
  });
  app.post<{Params:Params}>('/notes/:noteId/pages/:pageId/continue',async(request,reply)=>{
    reply.header('Cache-Control','no-store');
    return appendWritingContinuation(db,request.params.noteId,request.params.pageId,request.body);
  });
}
