import { randomUUID } from 'node:crypto';
import type { AppDatabase } from './db.js';
import { LibraryError } from './library.js';

export type CanvasKind = 'sticky' | 'text' | 'quote';
export interface CanvasItem {
  id: string;
  kind: CanvasKind;
  x: number; y: number; width: number; height: number;
  content: string;
  revision: number;
  createdAt: number;
  updatedAt: number;
}
type CanvasRow = CanvasItem;
export interface CanvasState { noteId: string; version: number; items: CanvasItem[] }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function uuid(value: unknown): string {
  if (typeof value !== 'string' || !UUID.test(value)) throw new LibraryError(400,'Invalid ID');
  return value;
}
function fields(payload: unknown, allowed: string[], mandatory: string[]): Record<string,unknown> {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new LibraryError(400,'Expected an object');
  }
  const item = payload as Record<string,unknown>;
  if (Object.keys(item).some(name=>!allowed.includes(name)) || mandatory.some(name=>!(name in item))) {
    throw new LibraryError(400,'Invalid canvas item fields');
  }
  return item;
}
function integer(value: unknown, name: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) {
    throw new LibraryError(400,'Invalid '+name);
  }
  return value;
}
function checkContent(value: unknown): string {
  if(typeof value!=='string' || value.length>6000 || value.includes('\u0000')) {
    throw new LibraryError(400,'Text must be at most 6000 characters');
  }
  return value;
}
function checkKind(value: unknown): CanvasKind {
  if(value!=='sticky' && value!=='text' && value!=='quote') throw new LibraryError(400,'Invalid item kind');
  return value;
}
function note(db:AppDatabase, noteId:string) {
  if(!db.prepare('SELECT 1 FROM notes WHERE id = ?').get(noteId)) throw new LibraryError(404,'Note not found');
}
function revision(value:unknown):number { return integer(value,'revision',0,Number.MAX_SAFE_INTEGER); }
function getItem(db:AppDatabase,noteId:string,itemId:string):CanvasItem {
  const row=db.prepare('SELECT id,kind,x,y,width,height,content,revision,created_at AS createdAt,updated_at AS updatedAt FROM canvas_items WHERE note_id=? AND id=?')
    .get(noteId,itemId) as CanvasRow|undefined;
  if(!row)throw new LibraryError(404,'Canvas item not found');
  return row;
}
function noteVersion(db:AppDatabase,noteId:string):number {
  const row=db.prepare('SELECT version FROM canvas_states WHERE note_id=?').get(noteId) as {version:number}|undefined;
  return row?.version??0;
}
function advance(db:AppDatabase,noteId:string):number {
  db.prepare('INSERT INTO canvas_states(note_id,version) VALUES (?,1) ON CONFLICT(note_id) DO UPDATE SET version=version+1').run(noteId);
  db.prepare('UPDATE notes SET updated_at=? WHERE id=?').run(Date.now(),noteId);
  return noteVersion(db,noteId);
}
export function getCanvas(db:AppDatabase,rawNote:unknown):CanvasState {
  const noteId=uuid(rawNote);
  note(db,noteId);
  const items=db.prepare('SELECT id,kind,x,y,width,height,content,revision,created_at AS createdAt,updated_at AS updatedAt FROM canvas_items WHERE note_id=? ORDER BY created_at,id')
    .all(noteId) as CanvasItem[];
  return {noteId,version:noteVersion(db,noteId),items};
}
export function createCanvasItem(db:AppDatabase,rawNote:unknown,body:unknown):
  {item:CanvasItem;version:number} {
  const noteId=uuid(rawNote);
  const args=fields(body,['kind','x','y','width','height','content','expectedVersion'],
    ['kind','x','y','width','height','expectedVersion']);
  const kind=checkKind(args.kind);
  const x=integer(args.x,'x',-200000,200000),y=integer(args.y,'y',-200000,200000);
  const width=integer(args.width,'width',120,900),height=integer(args.height,'height',90,800);
  const content=args.content===undefined?'':checkContent(args.content),expected=revision(args.expectedVersion);
  return db.transaction(()=>{
    note(db,noteId);
    if(noteVersion(db,noteId)!==expected)throw new LibraryError(409,'Canvas changed; reload before creating');
    const id=randomUUID(),now=Date.now();
    db.prepare('INSERT INTO canvas_items (id,note_id,kind,x,y,width,height,content,revision,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,1,?,?)')
      .run(id,noteId,kind,x,y,width,height,content,now,now);
    const version=advance(db,noteId);
    return {item:getItem(db,noteId,id),version};
  }).immediate();
}
export function updateCanvasItem(db:AppDatabase,rawNote:unknown,rawItem:unknown,body:unknown):
  {item:CanvasItem;version:number} {
  const noteId=uuid(rawNote),itemId=uuid(rawItem);
  const args=fields(body,['expectedRevision','x','y','width','height','content'],['expectedRevision']);
  if(Object.keys(args).length<2) throw new LibraryError(400,'No canvas change was supplied');
  const expected=revision(args.expectedRevision);
  const x=args.x===undefined?undefined:integer(args.x,'x',-200000,200000);
  const y=args.y===undefined?undefined:integer(args.y,'y',-200000,200000);
  const width=args.width===undefined?undefined:integer(args.width,'width',120,900);
  const height=args.height===undefined?undefined:integer(args.height,'height',90,800);
  const content=args.content===undefined?undefined:checkContent(args.content);
  return db.transaction(()=>{
    note(db,noteId);
    const original=getItem(db,noteId,itemId);
    if(original.revision!==expected)throw new LibraryError(409,'This canvas item was changed in another tab; your changes were not overwritten');
    db.prepare('UPDATE canvas_items SET x=?,y=?,width=?,height=?,content=?,revision=revision+1,updated_at=? WHERE note_id=? AND id=?')
      .run(x??original.x,y??original.y,width??original.width,height??original.height,content??original.content,Date.now(),noteId,itemId);
    const version=advance(db,noteId);
    return {item:getItem(db,noteId,itemId),version};
  }).immediate();
}
export function deleteCanvasItem(db:AppDatabase,rawNote:unknown,rawItem:unknown,body:unknown):
  {version:number} {
  const noteId=uuid(rawNote),itemId=uuid(rawItem);
  const args=fields(body,['expectedRevision'],['expectedRevision']);
  const expected=revision(args.expectedRevision);
  return db.transaction(()=>{
    note(db,noteId);
    const original=getItem(db,noteId,itemId);
    if(original.revision!==expected)throw new LibraryError(409,'This canvas item changed; reload before deleting');
    db.prepare('DELETE FROM canvas_items WHERE note_id=? AND id=?').run(noteId,itemId);
    return {version:advance(db,noteId)};
  }).immediate();
}
