import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createOwner } from '../src/auth.js';
import { buildApp } from '../src/app.js';
import { openDatabase } from '../src/db.js';
import type { AppConfig } from '../src/config.js';

const origin = 'http://localhost:5173';

test('library: nested folders, notes, ordering, moves, deletion safety, persistence, and access controls', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'notetaking-library-test-'));
  const filename = path.join(dir, 'library.sqlite');
  const config: AppConfig = {
    appOrigin: origin, databasePath: filename, host: '127.0.0.1', port: 3000, isProduction: false
  };
  let db = openDatabase(filename);
  let app = await buildApp({ db, config });
  const post = async (url: string, payload: unknown, cookie?: string) => app.inject({
    method: 'POST', url, headers: { origin, ...(cookie ? { cookie } : {}) }, payload
  });
  const patch = async (url: string, payload: unknown, cookie: string) => app.inject({
    method: 'PATCH', url, headers: { origin, cookie }, payload
  });
  const del = async (url: string, cookie: string) => app.inject({
    method: 'DELETE', url, headers: { origin, cookie }
  });
  try {
    await app.ready();
    assert.equal((db.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get() as { count: number }).count, 7);
    assert.equal((await app.inject({ method: 'GET', url: '/api/library' })).statusCode, 401);
    assert.equal((await post('/api/folders', { name: 'Unauthorized' })).statusCode, 401);
    await createOwner(db, 'secure-test-password-987');
    const login = await post('/api/auth/login', { password: 'secure-test-password-987' });
    assert.equal(login.statusCode, 200);
    const cookie = String(login.headers['set-cookie']).split(';')[0];
    assert.ok(cookie);
    const createFolder = async (name: string, parentId: string | null = null) => {
      const result = await post('/api/folders', { name, parentId }, cookie);
      assert.equal(result.statusCode, 201, result.body);
      return result.json().folder as { id: string; parentId: string | null; name: string; sortKey: number };
    };
    const createNote = async (title: string, folderId: string) => {
      const result = await post('/api/notes', { title, folderId }, cookie);
      assert.equal(result.statusCode, 201, result.body);
      return result.json().note as { id: string; folderId: string; title: string; sortKey: number };
    };
    const root = await createFolder('Semester');
    const a = await createFolder('Modern History', root.id);
    const b = await createFolder('WWI', a.id);
    const c = await createFolder('Lectures', b.id);
    const d = await createFolder('Week 1', c.id); // 5-level nesting
    const sibling = await createFolder('Sources', root.id);
    const note1 = await createNote('Lecture 1', d.id);
    const note2 = await createNote('Lecture 2', d.id);
    const note3 = await createNote('Primary sources', sibling.id);
    assert.notEqual(note1.id, note2.id);
    assert.notEqual(note1.folderId, note3.folderId);

    const cycle = await patch('/api/folders/' + root.id, { parentId: d.id }, cookie);
    assert.equal(cycle.statusCode, 409, cycle.body);
    assert.equal((await patch('/api/folders/' + root.id, { parentId: root.id }, cookie)).statusCode, 409);
    assert.equal((await del('/api/folders/' + root.id, cookie)).statusCode, 409);
    assert.equal((await del('/api/folders/' + d.id, cookie)).statusCode, 409);
    assert.equal((await patch('/api/notes/' + note1.id, { title: '  Lecture One  ' }, cookie)).json().note.title, 'Lecture One');
    assert.equal((await patch('/api/notes/' + note2.id, { beforeId: note1.id }, cookie)).statusCode, 200);
    let library = (await app.inject({ method: 'GET', url: '/api/library', headers: { cookie } })).json();
    assert.deepEqual(library.notes.filter((n: { folderId: string }) => n.folderId === d.id).map((n: { id: string }) => n.id), [note2.id, note1.id]);

    assert.equal((await patch('/api/notes/' + note1.id, { folderId: sibling.id }, cookie)).statusCode, 200);
    assert.equal((await patch('/api/notes/' + note3.id, { beforeId: note1.id }, cookie)).statusCode, 200);
    assert.equal((await patch('/api/folders/' + sibling.id, { parentId: a.id }, cookie)).statusCode, 200);
    assert.equal((await patch('/api/folders/' + b.id, { beforeId: root.id }, cookie)).statusCode, 400);
    assert.equal((await patch('/api/folders/' + sibling.id, { beforeId: b.id }, cookie)).statusCode, 200);
    assert.equal((await patch('/api/folders/' + d.id, { name: 'Week 1 updated' }, cookie)).statusCode, 200);

    // Malformed or invalid operations must not mutate data or expose internal errors.
    assert.equal((await patch('/api/notes/' + note1.id, { folderId: null }, cookie)).statusCode, 400);
    assert.equal((await patch('/api/notes/' + note1.id, { title: '\n' }, cookie)).statusCode, 400);
    assert.equal((await post('/api/folders', { name: 'x', unexpected: true }, cookie)).statusCode, 400);
    assert.equal((await del('/api/notes/not-an-id', cookie)).statusCode, 400);
    assert.equal((await del('/api/notes/00000000-0000-4000-8000-000000000000', cookie)).statusCode, 404);
    assert.equal((await app.inject({
      method: 'PATCH', url: '/api/notes/' + note1.id, headers: { cookie, origin: 'https://evil.invalid' },
      payload: { title: 'Attack' }
    })).statusCode, 403);

    await app.close();
    db.close();
    db = openDatabase(filename);
    app = await buildApp({ db, config });
    await app.ready();
    library = (await app.inject({ method: 'GET', url: '/api/library', headers: { cookie } })).json();
    assert.equal(library.folders.find((f: { id: string }) => f.id === d.id).name, 'Week 1 updated');
    assert.equal(library.notes.find((n: { id: string }) => n.id === note1.id).folderId, sibling.id);
    assert.deepEqual(library.notes.filter((n: { folderId: string }) => n.folderId === sibling.id).map((n: { id: string }) => n.id), [note3.id, note1.id]);
    assert.deepEqual(library.folders.filter((f: { parentId: string }) => f.parentId === a.id).map((f: { id: string }) => f.id), [sibling.id, b.id]);
    assert.equal((db.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get() as { count: number }).count, 7);

    assert.equal((await del('/api/notes/' + note2.id, cookie)).statusCode, 204);
    assert.equal((await del('/api/folders/' + d.id, cookie)).statusCode, 204);
    assert.equal((await del('/api/folders/' + c.id, cookie)).statusCode, 204);
    assert.equal((await del('/api/folders/' + b.id, cookie)).statusCode, 204);
    assert.equal((await del('/api/notes/' + note1.id, cookie)).statusCode, 204);
    assert.equal((await del('/api/notes/' + note3.id, cookie)).statusCode, 204);
    assert.equal((await del('/api/folders/' + sibling.id, cookie)).statusCode, 204);
  } finally {
    await app.close();
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
