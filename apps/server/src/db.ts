import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

export type AppDatabase = Database.Database;

const initialMigration = [
  'CREATE TABLE owners (',
  '  id INTEGER PRIMARY KEY CHECK (id = 1),',
  '  username TEXT NOT NULL UNIQUE,',
  '  password_hash TEXT NOT NULL,',
  '  created_at INTEGER NOT NULL',
  ');',
  'CREATE TABLE sessions (',
  '  token_hash TEXT PRIMARY KEY,',
  '  owner_id INTEGER NOT NULL REFERENCES owners(id) ON DELETE CASCADE,',
  '  created_at INTEGER NOT NULL,',
  '  expires_at INTEGER NOT NULL',
  ');',
  'CREATE INDEX sessions_expires_at_idx ON sessions(expires_at);'
].join('\n');


const libraryMigration = [
  'CREATE TABLE folders (',
  '  id TEXT PRIMARY KEY,',
  '  parent_id TEXT REFERENCES folders(id) ON DELETE RESTRICT,',
  '  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 120),',
  '  sort_key INTEGER NOT NULL,',
  '  created_at INTEGER NOT NULL',
  ');',
  'CREATE INDEX folders_parent_sort_idx ON folders(parent_id, sort_key, id);',
  'CREATE TABLE notes (',
  '  id TEXT PRIMARY KEY,',
  '  folder_id TEXT NOT NULL REFERENCES folders(id) ON DELETE RESTRICT,',
  '  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 160),',
  '  sort_key INTEGER NOT NULL,',
  '  created_at INTEGER NOT NULL,',
  '  updated_at INTEGER NOT NULL',
  ');',
  'CREATE INDEX notes_folder_sort_idx ON notes(folder_id, sort_key, id);'
].join('\n');


const pageMigration = [
  'CREATE TABLE note_pages (',
  '  id TEXT PRIMARY KEY,',
  '  note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,',
  '  gx INTEGER NOT NULL CHECK(gx BETWEEN -100000 AND 100000),',
  '  gy INTEGER NOT NULL CHECK(gy BETWEEN -100000 AND 100000),',
  '  created_at INTEGER NOT NULL,',
  '  UNIQUE(note_id, id),',
  '  UNIQUE(note_id, gx, gy)',
  ');',
  'CREATE INDEX note_pages_note_idx ON note_pages(note_id);',
  'CREATE TABLE page_edges (',
  '  id TEXT PRIMARY KEY,',
  '  note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,',
  '  from_page_id TEXT NOT NULL,',
  '  to_page_id TEXT NOT NULL,',
  "  direction TEXT NOT NULL CHECK(direction IN ('N','E','S','W')),",
  '  CHECK(from_page_id <> to_page_id),',
  '  FOREIGN KEY(note_id, from_page_id) REFERENCES note_pages(note_id, id) ON DELETE CASCADE,',
  '  FOREIGN KEY(note_id, to_page_id) REFERENCES note_pages(note_id, id) ON DELETE CASCADE,',
  '  UNIQUE(note_id, from_page_id, to_page_id)',
  ');',
  'CREATE INDEX page_edges_note_idx ON page_edges(note_id);',
  'CREATE TABLE note_layouts (',
  '  note_id TEXT PRIMARY KEY REFERENCES notes(id) ON DELETE CASCADE,',
  '  version INTEGER NOT NULL DEFAULT 0 CHECK(version >= 0)',
  ');'
].join('\n');

export function openDatabase(filename: string): AppDatabase {
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  const db = new Database(filename);
  db.pragma('foreign_keys = ON');
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  migrate(db);
  return db;
}

export function migrate(db: AppDatabase): void {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)');
  const migrations = [{ version: 1, sql: initialMigration }, { version: 2, sql: libraryMigration }, { version: 3, sql: pageMigration }];
  for (const migration of migrations) {
    db.transaction(() => {
      const existing = db.prepare('SELECT 1 FROM schema_migrations WHERE version = ?').get(migration.version);
      if (existing) return;
      db.exec(migration.sql);
      db.prepare('INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)').run(migration.version, Date.now());
    })();
  }
}
