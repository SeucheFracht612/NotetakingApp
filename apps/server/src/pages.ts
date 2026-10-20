import { randomUUID } from 'node:crypto';
import type { AppDatabase } from './db.js';
import { LibraryError } from './library.js';
import {
  GraphConflict, planInsertion, planLink, sideNeighbor, validateGraph, isDirection,
  DELTA, type Direction, type GridPage, type PageEdge, type InsertionPlan
} from './page-graph.js';

export interface NotePage extends GridPage { createdAt: number; }
export interface PageLayout {
  noteId: string;
  version: number;
  pages: NotePage[];
  edges: PageEdge[];
}

function requireObject(input: unknown, names: string[], required: string[]): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new LibraryError(400, 'Expected JSON object');
  const record = input as Record<string, unknown>;
  if (Object.keys(record).some(key => !names.includes(key)) ||
      required.some(key => !(key in record))) {
    throw new LibraryError(400, 'Invalid page operation fields');
  }
  return record;
}
function uuid(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw new LibraryError(400, 'Invalid UUID');
  }
  return value;
}
function version(input: unknown): number {
  if (typeof input !== 'number' || !Number.isSafeInteger(input) || input < 0) {
    throw new LibraryError(400, 'expectedVersion must be a nonnegative integer');
  }
  return input;
}
function direction(input: unknown): Direction {
  if (!isDirection(input)) throw new LibraryError(400, 'Direction must be N, E, S or W');
  return input;
}
function noteExists(db: AppDatabase, noteId: string): void {
  if (!db.prepare('SELECT 1 FROM notes WHERE id = ?').get(noteId)) {
    throw new LibraryError(404, 'Note not found');
  }
}
export function getPageLayout(db: AppDatabase, rawNoteId: unknown): PageLayout {
  const noteId = uuid(rawNoteId);
  noteExists(db, noteId);
  const row = db.prepare('SELECT version FROM note_layouts WHERE note_id = ?').get(noteId) as
    { version: number } | undefined;
  return {
    noteId,
    version: row?.version ?? 0,
    pages: db.prepare('SELECT id, gx, gy, created_at AS createdAt FROM note_pages WHERE note_id = ? ORDER BY created_at, id')
      .all(noteId) as NotePage[],
    edges: db.prepare('SELECT id, from_page_id AS fromPageId, to_page_id AS toPageId, direction FROM page_edges WHERE note_id = ? ORDER BY id')
      .all(noteId) as PageEdge[]
  };
}
function checkVersion(layout: PageLayout, expected: number): void {
  if (layout.version !== expected) {
    throw new LibraryError(409, 'This note layout changed in another tab; reload it before editing');
  }
}
function recordVersion(db: AppDatabase, noteId: string, oldVersion: number): void {
  db.prepare('INSERT INTO note_layouts(note_id, version) VALUES (?, ?) ON CONFLICT(note_id) DO UPDATE SET version = excluded.version')
    .run(noteId, oldVersion + 1);
  db.prepare('UPDATE notes SET updated_at = ? WHERE id = ?').run(Date.now(), noteId);
}
function translateGraphError(error: unknown): never {
  if (error instanceof GraphConflict) throw new LibraryError(409, error.message);
  throw error;
}

/** A continuation edge is part of the document's own writing flow.
    Manual page commands must not silently split or detach it. */
function continuationPair(db:AppDatabase,noteId:string,fromId:string,toId:string):boolean {
  const rows=db.prepare('SELECT page_id AS pageId, root_page_id AS rootId, ordinal FROM writing_flow_pages WHERE note_id=? AND page_id IN (?,?)')
    .all(noteId,fromId,toId) as {pageId:string;rootId:string;ordinal:number}[];
  if(rows.length!==2 || rows[0]!.rootId!==rows[1]!.rootId)return false;
  return Math.abs(rows[0]!.ordinal-rows[1]!.ordinal)===1;
}
function preventSplitContinuation(db:AppDatabase,noteId:string,fromId:string,toId:string|null):void {
  if(toId && continuationPair(db,noteId,fromId,toId)){
    throw new LibraryError(409,'This edge belongs to an automatic writing continuation and cannot be detached manually');
  }
}

export function initializeNotePage(db: AppDatabase, rawId: unknown, payload: unknown): PageLayout {
  const args = requireObject(payload, ['expectedVersion'], ['expectedVersion']);
  const expected = version(args.expectedVersion);
  const noteId = uuid(rawId);
  return db.transaction(() => {
    const layout = getPageLayout(db, noteId);
    checkVersion(layout, expected);
    if (layout.pages.length) throw new LibraryError(409, 'This note already has pages');
    db.prepare('INSERT INTO note_pages(id, note_id, gx, gy, created_at) VALUES (?, ?, 0, 0, ?)')
      .run(randomUUID(), noteId, Date.now());
    recordVersion(db, noteId, layout.version);
    return getPageLayout(db, noteId);
  }).immediate();
}
function requestInsertion(payload: unknown): { anchorId: string; direction: Direction; expected: number } {
  const args = requireObject(payload, ['anchorId', 'direction', 'expectedVersion'],
    ['anchorId', 'direction', 'expectedVersion']);
  return { anchorId: uuid(args.anchorId), direction: direction(args.direction),
    expected: version(args.expectedVersion) };
}
function checkedPlan(layout: PageLayout, anchorId: string, side: Direction): InsertionPlan {
  try { return planInsertion(layout.pages, layout.edges, anchorId, side); }
  catch (error) { return translateGraphError(error); }
}
export function previewPageInsertion(db: AppDatabase, rawId: unknown, payload: unknown):
  { version: number; plan: InsertionPlan } {
  const noteId = uuid(rawId);
  const args = requestInsertion(payload);
  const layout = getPageLayout(db, noteId);
  checkVersion(layout, args.expected);
  preventSplitContinuation(db,noteId,args.anchorId,
    sideNeighbor(args.anchorId,args.direction,layout.edges));
  return { version: layout.version, plan: checkedPlan(layout, args.anchorId, args.direction) };
}

export function insertPage(db: AppDatabase, rawId: unknown, payload: unknown): PageLayout {
  const noteId = uuid(rawId);
  const args = requestInsertion(payload);
  return db.transaction(() => {
    const layout = getPageLayout(db, noteId);
    checkVersion(layout, args.expected);
    if (layout.pages.length >= 2000) throw new LibraryError(409, 'Maximum page count reached');
    preventSplitContinuation(db,noteId,args.anchorId,
      sideNeighbor(args.anchorId,args.direction,layout.edges));
    const plan = checkedPlan(layout, args.anchorId, args.direction);
    const { dx, dy } = DELTA[args.direction];

    // Move the furthest page first to respect the unique grid-cell index
    // during a one-cell translation, without temporary invalid coordinates.
    const ordered = [...plan.shifts].sort((a, b) =>
      (b.fromGx * dx + b.fromGy * dy) - (a.fromGx * dx + a.fromGy * dy));
    const moveStatement = db.prepare('UPDATE note_pages SET gx = ?, gy = ? WHERE note_id = ? AND id = ?');
    for (const moved of ordered) moveStatement.run(moved.gx, moved.gy, noteId, moved.id);

    if (plan.replacedEdgeId) {
      db.prepare('DELETE FROM page_edges WHERE note_id = ? AND id = ?').run(noteId, plan.replacedEdgeId);
    }
    const pageId = randomUUID();
    db.prepare('INSERT INTO note_pages(id, note_id, gx, gy, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(pageId, noteId, plan.gx, plan.gy, Date.now());
    const insertEdge = db.prepare(
      'INSERT INTO page_edges(id, note_id, from_page_id, to_page_id, direction) VALUES (?, ?, ?, ?, ?)');
    insertEdge.run(randomUUID(), noteId, args.anchorId, pageId, args.direction);
    if (plan.previousNeighborId) {
      insertEdge.run(randomUUID(), noteId, pageId, plan.previousNeighborId, args.direction);
    }
    recordVersion(db, noteId, layout.version);
    const result = getPageLayout(db, noteId);
    validateGraph(result.pages, result.edges);
    return result;
  }).immediate();
}
export function attachAdjacentPages(db: AppDatabase, rawId: unknown, payload: unknown): PageLayout {
  const args = requireObject(payload, ['fromPageId','toPageId','direction','expectedVersion'],
    ['fromPageId','toPageId','direction','expectedVersion']);
  const noteId = uuid(rawId), fromId = uuid(args.fromPageId), toId = uuid(args.toPageId);
  const side = direction(args.direction), expected = version(args.expectedVersion);
  return db.transaction(() => {
    const layout = getPageLayout(db, noteId);
    checkVersion(layout, expected);
    try { planLink(layout.pages, layout.edges, fromId, toId, side); }
    catch (error) { return translateGraphError(error); }
    db.prepare('INSERT INTO page_edges(id, note_id, from_page_id, to_page_id, direction) VALUES (?, ?, ?, ?, ?)')
      .run(randomUUID(), noteId, fromId, toId, side);
    recordVersion(db, noteId, layout.version);
    return getPageLayout(db, noteId);
  }).immediate();
}
export function detachPageEdge(db: AppDatabase, rawId: unknown, payload: unknown): PageLayout {
  const args = requireObject(payload, ['fromPageId', 'direction', 'expectedVersion'],
    ['fromPageId', 'direction', 'expectedVersion']);
  const noteId = uuid(rawId), fromId = uuid(args.fromPageId), side = direction(args.direction);
  const expected = version(args.expectedVersion);
  return db.transaction(() => {
    const layout = getPageLayout(db, noteId);
    checkVersion(layout, expected);
    const neighbor = sideNeighbor(fromId, side, layout.edges);
    if (!neighbor) throw new LibraryError(409, 'No attachment exists on that side');
    preventSplitContinuation(db,noteId,fromId,neighbor);
    const edge = layout.edges.find(item =>
      (item.fromPageId === fromId && item.toPageId === neighbor) ||
      (item.fromPageId === neighbor && item.toPageId === fromId));
    if (!edge) throw new LibraryError(409, 'Attachment not found');
    db.prepare('DELETE FROM page_edges WHERE note_id = ? AND id = ?').run(noteId, edge.id);
    recordVersion(db, noteId, layout.version);
    return getPageLayout(db, noteId);
  }).immediate();
}
export function deleteLeafPage(db: AppDatabase, rawNoteId: unknown,
  rawPageId: unknown, payload: unknown): PageLayout {
  const args = requireObject(payload, ['expectedVersion'], ['expectedVersion']);
  const expected = version(args.expectedVersion);
  const noteId = uuid(rawNoteId), pageId = uuid(rawPageId);
  return db.transaction(() => {
    const layout = getPageLayout(db, noteId);
    checkVersion(layout, expected);
    if (!layout.pages.some(page => page.id === pageId)) throw new LibraryError(404, 'Page not found');
    const flow=db.prepare('SELECT root_page_id AS rootId, ordinal FROM writing_flow_pages WHERE note_id=? AND page_id=?')
      .get(noteId,pageId) as {rootId:string;ordinal:number}|undefined;
    if(flow){
      const count=(db.prepare('SELECT COUNT(*) AS count FROM writing_flow_pages WHERE note_id=? AND root_page_id=?')
        .get(noteId,flow.rootId) as {count:number}).count;
      if(flow.ordinal>0 || count>1){
        throw new LibraryError(409,'Continuation pages belong to a writing flow and cannot be deleted independently');
      }
    }
    const degree = layout.edges.filter(edge => edge.fromPageId === pageId || edge.toPageId === pageId).length;
    if (degree > 1) throw new LibraryError(409, 'Only leaf pages can be deleted in Slice 2');
    db.prepare('DELETE FROM note_pages WHERE note_id = ? AND id = ?').run(noteId, pageId);
    recordVersion(db, noteId, layout.version);
    return getPageLayout(db, noteId);
  }).immediate();
}
