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
  const migrations = [{ version: 1, sql: initialMigration }];
  for (const migration of migrations) {
    db.transaction(() => {
      const existing = db.prepare('SELECT 1 FROM schema_migrations WHERE version = ?').get(migration.version);
      if (existing) return;
      db.exec(migration.sql);
      db.prepare('INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)').run(migration.version, Date.now());
    })();
  }
}
