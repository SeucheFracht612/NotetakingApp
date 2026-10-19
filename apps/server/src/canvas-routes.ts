import type { FastifyInstance } from 'fastify';
import type { AppDatabase } from './db.js';
import { getCanvas,createCanvasItem,updateCanvasItem,deleteCanvasItem } from './canvas.js';

interface NoteParams {noteId:string}
interface ItemParams extends NoteParams {itemId:string}
export function registerCanvasRoutes(app:FastifyInstance,db:AppDatabase) {
  app.get<{Params:NoteParams}>('/notes/:noteId/canvas',async(request,reply)=>{
    reply.header('Cache-Control','no-store');
    return getCanvas(db,request.params.noteId);
  });
  app.post<{Params:NoteParams}>('/notes/:noteId/canvas/items',async(request,reply)=>{
    reply.header('Cache-Control','no-store');
    return reply.code(201).send(createCanvasItem(db,request.params.noteId,request.body));
  });
  app.patch<{Params:ItemParams}>('/notes/:noteId/canvas/items/:itemId',async(request,reply)=>{
    reply.header('Cache-Control','no-store');
    return updateCanvasItem(db,request.params.noteId,request.params.itemId,request.body);
  });
  app.delete<{Params:ItemParams}>('/notes/:noteId/canvas/items/:itemId',async(request,reply)=>{
    reply.header('Cache-Control','no-store');
    return deleteCanvasItem(db,request.params.noteId,request.params.itemId,request.body);
  });
}
