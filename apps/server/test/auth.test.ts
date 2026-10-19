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

test('owner auth, session persistence, CSRF, and logout', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'notetaking-test-'));
  const filename = path.join(dir, 'test.sqlite');
  const config: AppConfig = {
    appOrigin: origin, databasePath: filename, host: '127.0.0.1', port: 3000, isProduction: false
  };
  try {
    let db = openDatabase(filename);
    const migrations = db.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get() as { count: number };
    assert.equal(migrations.count, 3);
    await createOwner(db, 'correct-horse-battery-staple');
    await assert.rejects(() => createOwner(db, 'another-long-password'), /already exists/);
    let app = await buildApp({ db, config });
    await app.ready();

    const unauthorized = await app.inject({ method: 'GET', url: '/api/auth/me' });
    assert.equal(unauthorized.statusCode, 401);

    const forbidden = await app.inject({
      method: 'POST', url: '/api/auth/login', headers: { origin: 'https://evil.example' },
      payload: { password: 'correct-horse-battery-staple' }
    });
    assert.equal(forbidden.statusCode, 403);

    const invalid = await app.inject({
      method: 'POST', url: '/api/auth/login', headers: { origin },
      payload: { password: 'wrong' }
    });
    assert.equal(invalid.statusCode, 401);

    const loggedIn = await app.inject({
      method: 'POST', url: '/api/auth/login', headers: { origin },
      payload: { password: 'correct-horse-battery-staple' }
    });
    assert.equal(loggedIn.statusCode, 200);
    const setCookie = String(loggedIn.headers['set-cookie']);
    assert.match(setCookie, /HttpOnly/);
    assert.match(setCookie, /SameSite=Lax/);
    assert.doesNotMatch(setCookie, /Secure/);
    const cookie = setCookie.split(';')[0];
    assert.ok(cookie?.startsWith('notetaking_session='));

    await app.close();
    db.close();
    db = openDatabase(filename);
    app = await buildApp({ db, config });
    await app.ready();

    const restored = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } });
    assert.equal(restored.statusCode, 200);
    assert.equal(restored.json().owner.username, 'owner');

    const signedOut = await app.inject({
      method: 'POST', url: '/api/auth/logout', headers: { origin, cookie }
    });
    assert.equal(signedOut.statusCode, 200);
    const afterLogout = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } });
    assert.equal(afterLogout.statusCode, 401);
    await app.close();
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('rate limiting bounds repeated login attempts', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'notetaking-rate-test-'));
  const db = openDatabase(path.join(dir, 'test.sqlite'));
  const config: AppConfig = {
    appOrigin: origin, databasePath: path.join(dir, 'test.sqlite'),
    host: '127.0.0.1', port: 3000, isProduction: false
  };
  const app = await buildApp({ db, config });
  try {
    await app.ready();
    for (let attempt = 0; attempt < 5; attempt++) {
      const response = await app.inject({
        method: 'POST', url: '/api/auth/login', headers: { origin },
        payload: { password: 'invalid' }
      });
      assert.equal(response.statusCode, 401);
    }
    const response = await app.inject({
      method: 'POST', url: '/api/auth/login', headers: { origin },
      payload: { password: 'invalid' }
    });
    assert.equal(response.statusCode, 429);
  } finally {
    await app.close();
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('production cookie requires HTTPS and has Secure attribute', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'notetaking-prod-test-'));
  const db = openDatabase(path.join(dir, 'test.sqlite'));
  const config: AppConfig = {
    appOrigin: 'https://notes.example.com', databasePath: path.join(dir, 'test.sqlite'),
    host: '127.0.0.1', port: 3000, isProduction: true
  };
  try {
    await createOwner(db, 'correct-horse-battery-staple');
    const app = await buildApp({ db, config });
    try {
      const response = await app.inject({
        method: 'POST', url: '/api/auth/login', headers: { origin: config.appOrigin },
        payload: { password: 'correct-horse-battery-staple' }
      });
      assert.equal(response.statusCode, 200);
      assert.match(String(response.headers['set-cookie']), /; Secure/);
    } finally {
      await app.close();
    }
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
