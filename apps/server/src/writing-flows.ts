import { randomUUID } from 'node:crypto';
import type { AppDatabase } from './db.js';
import { LibraryError } from './library.js';
import { EMPTY_DOCUMENT, validateDocument, type RichDoc } from './document-schema.js';
import { getPageLayout } from './pages.js';
import { planInsertion, validateGraph, GraphConflict, type InsertionPlan } from './page-graph.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_FLOW_PAGES = 200;
interface MemberRow { pageId: string; ordinal: number }
export interface WritingFlow {
  noteId: string;
  rootPageId: string;
  revision: number;
  doc: RichDoc;
  updatedAt: number;
  pageIds: string[];
}
function id(raw: unknown): string {
  if (typeof raw !== 'string' || !UUID.test(raw)) throw new LibraryError(400, 'Invalid page or note ID');
  return raw;
}
function payload(raw: unknown, fields: string[]): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new LibraryError(400,'Expected JSON object');
  const args = raw as Record<string,unknown>;
  if (Object.keys(args).some(key => !fields.includes(key)) || fields.some(key => !(key in args))) {
    throw new LibraryError(400,'Invalid writing flow payload');
  }
  return args;
}
function integer(raw: unknown, label:string):number {
  if (typeof raw !== 'number' || !Number.isSafeInteger(raw) || raw < 0) {
    throw new LibraryError(400,'Invalid '+label);
  }
  return raw;
}
function member(db:AppDatabase,noteId:string,pageId:string):
  { rootPageId: string } | undefined {
  return db.prepare('SELECT root_page_id AS rootPageId FROM writing_flow_pages WHERE note_id=? AND page_id=?')
    .get(noteId,pageId) as {rootPageId:string}|undefined;
}
function ensureFlow(db:AppDatabase,noteId:string,pageId:string):string {
  if (!db.prepare('SELECT 1 FROM note_pages WHERE note_id=? AND id=?').get(noteId,pageId)) {
    throw new LibraryError(404,'Page not found');
  }
  const present=member(db,noteId,pageId);
  if (present) return present.rootPageId;
  const source=db.prepare('SELECT revision, document_json AS json, updated_at AS updatedAt FROM page_documents WHERE note_id=? AND page_id=?')
    .get(noteId,pageId) as {revision:number;json:string;updatedAt:number}|undefined;
  db.prepare('INSERT INTO writing_flows(note_id,root_page_id,revision,document_json,updated_at) VALUES(?,?,?,?,?)')
    .run(noteId,pageId,source?.revision??0,source?.json??JSON.stringify(EMPTY_DOCUMENT),source?.updatedAt??Date.now());
  db.prepare('INSERT INTO writing_flow_pages(note_id,page_id,root_page_id,ordinal) VALUES(?,?,?,0)')
    .run(noteId,pageId,pageId);
  return pageId;
}
function read(db:AppDatabase,noteId:string,rootPageId:string):WritingFlow {
  const row=db.prepare('SELECT revision,document_json AS json,updated_at AS updatedAt FROM writing_flows WHERE note_id=? AND root_page_id=?')
    .get(noteId,rootPageId) as {revision:number;json:string;updatedAt:number}|undefined;
  if (!row) throw new LibraryError(404,'Writing flow not found');
  const pages=db.prepare('SELECT page_id AS pageId,ordinal FROM writing_flow_pages WHERE note_id=? AND root_page_id=? ORDER BY ordinal')
    .all(noteId,rootPageId) as MemberRow[];
  return { noteId,rootPageId,revision:row.revision,
    doc:JSON.parse(row.json) as RichDoc,updatedAt:row.updatedAt,
    pageIds:pages.map(page=>page.pageId) };
}
export function getWritingFlow(db:AppDatabase,rawNote:unknown,rawPage:unknown):WritingFlow {
  const noteId=id(rawNote),pageId=id(rawPage);
  return db.transaction(()=>{
    const root=ensureFlow(db,noteId,pageId);
    return read(db,noteId,root);
  }).immediate();
}
export function saveWritingFlow(db:AppDatabase,rawNote:unknown,rawPage:unknown,raw:unknown):WritingFlow {
  const noteId=id(rawNote),pageId=id(rawPage);
  const args=payload(raw,['expectedRevision','doc']);
  const expected=integer(args.expectedRevision,'expectedRevision');
  const doc=validateDocument(args.doc);
  return db.transaction(()=>{
    const root=ensureFlow(db,noteId,pageId), current=read(db,noteId,root);
    if (current.revision!==expected) {
      throw new LibraryError(409,'This writing flow changed in another tab; your local document was not overwritten');
    }
    const now=Date.now();
    db.prepare('UPDATE writing_flows SET revision=revision+1,document_json=?,updated_at=? WHERE note_id=? AND root_page_id=?')
      .run(JSON.stringify(doc),now,noteId,root);
    db.prepare('UPDATE notes SET updated_at=? WHERE id=?').run(now,noteId);
    return read(db,noteId,root);
  }).immediate();
}
export interface ContinuationResult { flow:WritingFlow; layout:ReturnType<typeof getPageLayout>; plan:InsertionPlan }
/** Append a physical page below the flow's tail, preserving unrelated attachments. */
export function appendWritingContinuation(db:AppDatabase,rawNote:unknown,rawPage:unknown,raw:unknown):ContinuationResult {
  const noteId=id(rawNote),pageId=id(rawPage);
  const args=payload(raw,['expectedLayoutVersion','expectedFlowRevision']);
  const expectedLayout=integer(args.expectedLayoutVersion,'expectedLayoutVersion');
  const expectedFlow=integer(args.expectedFlowRevision,'expectedFlowRevision');
  return db.transaction(()=>{
    const root=ensureFlow(db,noteId,pageId);
    const flow=read(db,noteId,root),layout=getPageLayout(db,noteId);
    if(layout.version!==expectedLayout || flow.revision!==expectedFlow) {
      throw new LibraryError(409,'The page layout or document has changed; reload before continuing');
    }
    if(flow.pageIds.length>=MAX_FLOW_PAGES || layout.pages.length>=2000){
      throw new LibraryError(409,'Page limit reached');
    }
    const tail=flow.pageIds[flow.pageIds.length-1]!;
    let plan:InsertionPlan;
    try{plan=planInsertion(layout.pages,layout.edges,tail,'S');}
    catch(cause) {
      if(cause instanceof GraphConflict)throw new LibraryError(409,cause.message);
      throw cause;
    }
    const moved=[...plan.shifts].sort((a,b)=>b.fromGy-a.fromGy);
    const move=db.prepare('UPDATE note_pages SET gx=?,gy=? WHERE note_id=? AND id=?');
    for(const entry of moved)move.run(entry.gx,entry.gy,noteId,entry.id);
    if(plan.replacedEdgeId){
      db.prepare('DELETE FROM page_edges WHERE note_id=? AND id=?').run(noteId,plan.replacedEdgeId);
    }
    const createdId=randomUUID();
    db.prepare('INSERT INTO note_pages(id,note_id,gx,gy,created_at) VALUES(?,?,?,?,?)')
      .run(createdId,noteId,plan.gx,plan.gy,Date.now());
    const edge=db.prepare('INSERT INTO page_edges(id,note_id,from_page_id,to_page_id,direction) VALUES(?,?,?,?,?)');
    edge.run(randomUUID(),noteId,tail,createdId,'S');
    if(plan.previousNeighborId) edge.run(randomUUID(),noteId,createdId,plan.previousNeighborId,'S');
    db.prepare('INSERT INTO writing_flow_pages(note_id,page_id,root_page_id,ordinal) VALUES(?,?,?,?)')
      .run(noteId,createdId,root,flow.pageIds.length);
    db.prepare('INSERT INTO note_layouts(note_id,version) VALUES(?,?) ON CONFLICT(note_id) DO UPDATE SET version=version+1')
      .run(noteId,layout.version+1);
    db.prepare('UPDATE notes SET updated_at=? WHERE id=?').run(Date.now(),noteId);
    const result=getPageLayout(db,noteId);
    validateGraph(result.pages,result.edges);
    return {flow:read(db,noteId,root),layout:result,plan};
  }).immediate();
}
