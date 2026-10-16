import { createHash, randomBytes } from 'node:crypto';
import argon2 from 'argon2';
import type { AppDatabase } from './db.js';

export interface Owner {
  id: number;
  username: string;
}

interface OwnerRow extends Owner {
  password_hash: string;
}

const SESSION_AGE_SECONDS = 7 * 24 * 60 * 60;
const SESSION_COOKIE = 'notetaking_session';

function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function createOwner(db: AppDatabase, password: string): Promise<void> {
  if (password.length < 12) throw new Error('Password must contain at least 12 characters');
  if (password.length > 1024) throw new Error('Password is too long');
  if (db.prepare('SELECT id FROM owners LIMIT 1').get()) throw new Error('An owner already exists');
  const hashed = await argon2.hash(password, { type: argon2.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 1 });
  db.prepare('INSERT INTO owners(id, username, password_hash, created_at) VALUES (1, ?, ?, ?)').run('owner', hashed, Date.now());
}

export async function verifyPassword(db: AppDatabase, password: string): Promise<Owner | null> {
  const owner = db.prepare('SELECT id, username, password_hash FROM owners WHERE id = 1').get() as OwnerRow | undefined;
  if (!owner || password.length > 1024) return null;
  const valid = await argon2.verify(owner.password_hash, password);
  return valid ? { id: owner.id, username: owner.username } : null;
}

export function createSession(db: AppDatabase, ownerId: number): string {
  const token = randomBytes(32).toString('base64url');
  const now = Date.now();
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now);
  db.prepare('INSERT INTO sessions(token_hash, owner_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .run(tokenHash(token), ownerId, now, now + SESSION_AGE_SECONDS * 1000);
  return token;
}

export function ownerForToken(db: AppDatabase, token: string | undefined): Owner | null {
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const row = db.prepare(
    'SELECT owners.id, owners.username FROM sessions JOIN owners ON owners.id = sessions.owner_id ' +
    'WHERE sessions.token_hash = ? AND sessions.expires_at > ?'
  ).get(tokenHash(token), Date.now()) as Owner | undefined;
  return row ?? null;
}

export function revokeSession(db: AppDatabase, token: string | undefined): void {
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash(token));
}

export function sessionFromCookie(cookieHeader: string | undefined): string | undefined {
  const part = cookieHeader?.split(';').find((entry) => entry.trim().startsWith(SESSION_COOKIE + '='));
  return part?.trim().slice(SESSION_COOKIE.length + 1);
}

export function sessionCookie(token: string, secure: boolean): string {
  return SESSION_COOKIE + '=' + token + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=' +
    SESSION_AGE_SECONDS + (secure ? '; Secure' : '');
}

export function clearSessionCookie(secure: boolean): string {
  return SESSION_COOKIE + '=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0' + (secure ? '; Secure' : '');
}
