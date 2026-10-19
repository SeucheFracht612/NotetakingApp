import type { FastifyInstance } from 'fastify';
import type { AppDatabase } from './db.js';
import { LibraryError } from './library.js';
import { EMPTY_DOCUMENT, validateDocument, type RichDoc } from './document-schema.js';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
interface PageParams { noteId: string; pageId: string }
interface DocumentResult { noteId: string; pageId: string; revision: number; doc: RichDoc; updatedAt: number | null }

function readPageDocument(db: AppDatabase, { noteId, pageId }: PageParams): DocumentResult {
  if (!uuid.test(noteId) || !uuid.test(pageId)) throw new LibraryError(400, 'Invalid page identifier');
  const exists = db.prepare('SELECT 1 FROM note_pages WHERE note_id = ? AND id = ?').get(noteId, pageId);
  if (!exists) throw new LibraryError(404, 'Page not found in this note');
  const row = db.prepare('SELECT revision, document_json AS docJson, updated_at AS updatedAt FROM page_documents WHERE note_id = ? AND page_id = ?')
    .get(noteId,pageId) as { revision: number; docJson: string; updatedAt: number } | undefined;
  return { noteId,pageId, revision:row?.revision??0,
    doc:row ? JSON.parse(row.docJson) as RichDoc : EMPTY_DOCUMENT, updatedAt:row?.updatedAt??null };
}
function validateWrite(payload: unknown): { expectedRevision: number; doc: RichDoc } {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new LibraryError(400, 'Invalid request body');
  const data = payload as Record<string,unknown>;
  if (Object.keys(data).sort().join(',') !== 'doc,expectedRevision' ||
    typeof data.expectedRevision !== 'number' || !Number.isSafeInteger(data.expectedRevision) ||
    data.expectedRevision < 0) throw new LibraryError(400, 'Invalid request fields');
  return { expectedRevision:data.expectedRevision,doc:validateDocument(data.doc) };
}
export function registerDocumentRoutes(app: FastifyInstance, db: AppDatabase): void {

  // A single compact request supports a useful zoomed-out overview without
  // mounting hundreds of rich-text editors or issuing one request per page.
  app.get<{ Params: { noteId: string } }>('/notes/:noteId/page-previews', async(request,reply)=>{
    const noteId=request.params.noteId;
    if(!uuid.test(noteId))throw new LibraryError(400,'Invalid note identifier');
    if(!db.prepare('SELECT 1 FROM notes WHERE id=?').get(noteId))
      throw new LibraryError(404,'Note not found');
    const rows=db.prepare('SELECT p.id, d.document_json AS json FROM note_pages p LEFT JOIN page_documents d ON d.note_id=p.note_id AND d.page_id=p.id WHERE p.note_id=?')
      .all(noteId) as {id:string;json:string|null}[];
    const previews:Record<string,string>={};
    for(const row of rows){
      if(!row.json){previews[row.id]='';continue;}
      const root=JSON.parse(row.json) as {type?:string;content?:unknown[]};
      const chunks:string[]=[];
      let length=0;
      function walk(value:unknown){
        if(length>=420 || !value || typeof value!=='object')return;
        const n=value as {type?:string;text?:string;content?:unknown[]};
        if(n.type==='text' && n.text){
          const bit=n.text.slice(0,420-length);
          chunks.push(bit);length+=bit.length;
          return;
        }
        for(const child of n.content??[])walk(child);
        if(['paragraph','heading','blockquote','listItem','codeBlock'].includes(n.type??'') && length<420){
          chunks.push('\n');length++;
        }
      }
      walk(root);
      previews[row.id]=chunks.join('').trim().slice(0,420);
    }
    reply.header('Cache-Control','no-store');
    return {noteId,previews};
  });
  app.get<{ Params: PageParams }>('/notes/:noteId/pages/:pageId/document', async (request,reply) => {
    reply.header('Cache-Control','no-store');
    return readPageDocument(db,request.params);
  });
  app.put<{ Params: PageParams }>('/notes/:noteId/pages/:pageId/document', async (request,reply) => {
    const {expectedRevision,doc}=validateWrite(request.body);
    const result = db.transaction(() => {
      const current=readPageDocument(db,request.params);
      if (current.revision !== expectedRevision) {
        throw new LibraryError(409,'Page content changed in another tab; your local draft was not overwritten');
      }
      const now=Date.now();
      db.prepare('INSERT INTO page_documents(note_id,page_id,revision,document_json,updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(note_id,page_id) DO UPDATE SET revision=excluded.revision, document_json=excluded.document_json, updated_at=excluded.updated_at')
        .run(request.params.noteId,request.params.pageId,current.revision+1,JSON.stringify(doc),now);
      db.prepare('UPDATE notes SET updated_at = ? WHERE id = ?').run(now,request.params.noteId);
      return readPageDocument(db,request.params);
    }).immediate();
    reply.header('Cache-Control','no-store');
    return result;
  });
}
