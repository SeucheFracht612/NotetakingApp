import { randomUUID } from 'node:crypto';
import type { AppDatabase } from './db.js';

export interface Folder {
  id: string;
  parentId: string | null;
  name: string;
  sortKey: number;
  createdAt: number;
}

export interface Note {
  id: string;
  folderId: string;
  title: string;
  sortKey: number;
  createdAt: number;
  updatedAt: number;
}

export class LibraryError extends Error {
  constructor(public readonly status: 400 | 404 | 409, message: string) {
    super(message);
  }
}

function object(value: unknown, allowed: string[], required: string[] = []): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new LibraryError(400, 'Expected a JSON object');
  }
  const fields = value as Record<string, unknown>;
  if (!Object.keys(fields).length || Object.keys(fields).some(key => !allowed.includes(key)) ||
      required.some(key => !(key in fields))) {
    throw new LibraryError(400, 'Invalid request fields');
  }
  return fields;
}

function text(value: unknown, field: string, maximum: number): string {
  if (typeof value !== 'string' || /[\u0000-\u001f\u007f]/u.test(value) ||
      !value.trim() || value.trim().length > maximum) {
    throw new LibraryError(400, field + ' must be 1–' + maximum + ' characters, without control characters');
  }
  return value.trim();
}

function id(value: unknown, name: string): string {
  if (typeof value !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw new LibraryError(400, 'Invalid ' + name);
  }
  return value;
}

function optionalId(value: unknown, name: string): string | null {
  return value === null ? null : id(value, name);
}

function folder(db: AppDatabase, folderId: string): Folder {
  const row = db.prepare('SELECT id, parent_id AS parentId, name, sort_key AS sortKey, created_at AS createdAt FROM folders WHERE id = ?')
    .get(folderId) as Folder | undefined;
  if (!row) throw new LibraryError(404, 'Folder not found');
  return row;
}

function note(db: AppDatabase, noteId: string): Note {
  const row = db.prepare('SELECT id, folder_id AS folderId, title, sort_key AS sortKey, created_at AS createdAt, updated_at AS updatedAt FROM notes WHERE id = ?')
    .get(noteId) as Note | undefined;
  if (!row) throw new LibraryError(404, 'Note not found');
  return row;
}

function ensureDestination(db: AppDatabase, destination: string | null): void {
  if (destination !== null) folder(db, destination);
}

type Kind = 'folders' | 'notes';

function siblingIds(db: AppDatabase, kind: Kind, parentId: string | null): string[] {
  const key = kind === 'folders' ? 'parent_id' : 'folder_id';
  const sql = kind === 'folders'
    ? 'SELECT id FROM folders WHERE parent_id IS ? ORDER BY sort_key, created_at, id'
    : 'SELECT id FROM notes WHERE folder_id = ? ORDER BY sort_key, created_at, id';
  return (db.prepare(sql).all(parentId) as { id: string }[]).map(row => row.id);
}

function resequence(db: AppDatabase, kind: Kind, parentId: string | null, ordered: string[]): void {
  const sql = kind === 'folders'
    ? 'UPDATE folders SET sort_key = ? WHERE id = ? AND parent_id IS ?'
    : 'UPDATE notes SET sort_key = ? WHERE id = ? AND folder_id = ?';
  const statement = db.prepare(sql);
  for (let index = 0; index < ordered.length; index++) {
    const result = statement.run(index, ordered[index], parentId);
    if (result.changes !== 1) throw new Error('Sibling ordering invariant violated');
  }
}

function insertBefore(ids: string[], movingId: string, beforeId: string | null): string[] {
  const remaining = ids.filter(value => value !== movingId);
  if (beforeId !== null && !remaining.includes(beforeId)) {
    throw new LibraryError(400, 'beforeId must refer to another item in the destination');
  }
  const insertAt = beforeId === null ? remaining.length : remaining.indexOf(beforeId);
  remaining.splice(insertAt, 0, movingId);
  return remaining;
}

function nextKey(db: AppDatabase, kind: Kind, parent: string | null): number {
  const key = kind === 'folders' ? 'parent_id' : 'folder_id';
  const result = db.prepare('SELECT COALESCE(MAX(sort_key), -1) AS next FROM ' + kind + ' WHERE ' + key + ' IS ?')
    .get(parent) as { next: number };
  return result.next + 1;
}

export function readLibrary(db: AppDatabase): { folders: Folder[]; notes: Note[] } {
  return {
    folders: db.prepare('SELECT id, parent_id AS parentId, name, sort_key AS sortKey, created_at AS createdAt FROM folders ORDER BY sort_key, created_at, id').all() as Folder[],
    notes: db.prepare('SELECT id, folder_id AS folderId, title, sort_key AS sortKey, created_at AS createdAt, updated_at AS updatedAt FROM notes ORDER BY sort_key, created_at, id').all() as Note[]
  };
}

export function createFolder(db: AppDatabase, payload: unknown): Folder {
  const args = object(payload, ['name', 'parentId', 'beforeId'], ['name']);
  const name = text(args.name, 'Folder name', 120);
  const parentId = 'parentId' in args ? optionalId(args.parentId, 'parentId') : null;
  const beforeId = 'beforeId' in args ? optionalId(args.beforeId, 'beforeId') : null;
  return db.transaction(() => {
    ensureDestination(db, parentId);
    const folderId = randomUUID();
    db.prepare('INSERT INTO folders(id, parent_id, name, sort_key, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(folderId, parentId, name, nextKey(db, 'folders', parentId), Date.now());
    if (beforeId !== null) {
      resequence(db, 'folders', parentId, insertBefore(siblingIds(db, 'folders', parentId), folderId, beforeId));
    }
    return folder(db, folderId);
  })();
}

export function updateFolder(db: AppDatabase, rawId: unknown, payload: unknown): Folder {
  const folderId = id(rawId, 'folder ID');
  const args = object(payload, ['name', 'parentId', 'beforeId']);
  const name = 'name' in args ? text(args.name, 'Folder name', 120) : undefined;
  const requestedParent = 'parentId' in args ? optionalId(args.parentId, 'parentId') : undefined;
  const requestedBefore = 'beforeId' in args ? optionalId(args.beforeId, 'beforeId') : undefined;
  return db.transaction(() => {
    const current = folder(db, folderId);
    const destination = requestedParent === undefined ? current.parentId : requestedParent;
    ensureDestination(db, destination);
    if (destination === folderId) throw new LibraryError(409, 'A folder cannot contain itself');
    const visited = new Set<string>();
    let ancestor = destination;
    while (ancestor !== null) {
      if (ancestor === folderId || visited.has(ancestor)) {
        throw new LibraryError(409, 'A folder cannot move into its own descendant');
      }
      visited.add(ancestor);
      ancestor = folder(db, ancestor).parentId;
    }
    const moving = destination !== current.parentId;
    if (name !== undefined) db.prepare('UPDATE folders SET name = ? WHERE id = ?').run(name, folderId);
    if (moving) {
      db.prepare('UPDATE folders SET parent_id = ? WHERE id = ?').run(destination, folderId);
      resequence(db, 'folders', current.parentId, siblingIds(db, 'folders', current.parentId));
    }
    if (moving || requestedBefore !== undefined) {
      resequence(db, 'folders', destination,
        insertBefore(siblingIds(db, 'folders', destination), folderId, requestedBefore ?? null));
    }
    return folder(db, folderId);
  })();
}

export function deleteFolder(db: AppDatabase, rawId: unknown): void {
  const folderId = id(rawId, 'folder ID');
  db.transaction(() => {
    const current = folder(db, folderId);
    if (db.prepare('SELECT 1 FROM folders WHERE parent_id = ? UNION SELECT 1 FROM notes WHERE folder_id = ? LIMIT 1')
      .get(folderId, folderId)) {
      throw new LibraryError(409, 'Folder is not empty; move or delete its contents first');
    }
    db.prepare('DELETE FROM folders WHERE id = ?').run(folderId);
    resequence(db, 'folders', current.parentId, siblingIds(db, 'folders', current.parentId));
  })();
}

export function createNote(db: AppDatabase, payload: unknown): Note {
  const args = object(payload, ['title', 'folderId', 'beforeId'], ['title', 'folderId']);
  const title = text(args.title, 'Note title', 160);
  const destination = id(args.folderId, 'folderId');
  const beforeId = 'beforeId' in args ? optionalId(args.beforeId, 'beforeId') : null;
  return db.transaction(() => {
    folder(db, destination);
    const noteId = randomUUID();
    const now = Date.now();
    db.prepare('INSERT INTO notes(id, folder_id, title, sort_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(noteId, destination, title, nextKey(db, 'notes', destination), now, now);
    if (beforeId !== null) {
      resequence(db, 'notes', destination, insertBefore(siblingIds(db, 'notes', destination), noteId, beforeId));
    }
    return note(db, noteId);
  })();
}

export function updateNote(db: AppDatabase, rawId: unknown, payload: unknown): Note {
  const noteId = id(rawId, 'note ID');
  const args = object(payload, ['title', 'folderId', 'beforeId']);
  const title = 'title' in args ? text(args.title, 'Note title', 160) : undefined;
  const requestedFolder = 'folderId' in args ? id(args.folderId, 'folderId') : undefined;
  const requestedBefore = 'beforeId' in args ? optionalId(args.beforeId, 'beforeId') : undefined;
  return db.transaction(() => {
    const current = note(db, noteId);
    const destination = requestedFolder ?? current.folderId;
    folder(db, destination);
    const moving = destination !== current.folderId;
    if (moving) {
      db.prepare('UPDATE notes SET folder_id = ? WHERE id = ?').run(destination, noteId);
      resequence(db, 'notes', current.folderId, siblingIds(db, 'notes', current.folderId));
    }
    if (moving || requestedBefore !== undefined) {
      resequence(db, 'notes', destination,
        insertBefore(siblingIds(db, 'notes', destination), noteId, requestedBefore ?? null));
    }
    if (title !== undefined || moving || requestedBefore !== undefined) {
      db.prepare('UPDATE notes SET title = COALESCE(?, title), updated_at = ? WHERE id = ?')
        .run(title ?? null, Date.now(), noteId);
    }
    return note(db, noteId);
  })();
}

export function deleteNote(db: AppDatabase, rawId: unknown): void {
  const noteId = id(rawId, 'note ID');
  db.transaction(() => {
    const current = note(db, noteId);
    db.prepare('DELETE FROM notes WHERE id = ?').run(noteId);
    resequence(db, 'notes', current.folderId, siblingIds(db, 'notes', current.folderId));
  })();
}
