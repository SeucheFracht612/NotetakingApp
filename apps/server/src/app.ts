import path from 'node:path';
import Fastify from 'fastify';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import type { AppDatabase } from './db.js';
import type { AppConfig } from './config.js';
import {
  clearSessionCookie, createSession, ownerForToken, revokeSession,
  sessionCookie, sessionFromCookie, verifyPassword
} from './auth.js';

interface Options {
  db: AppDatabase;
  config: AppConfig;
  serveWeb?: boolean;
  logger?: boolean;
}

export async function buildApp({ db, config, serveWeb = false, logger = false }: Options) {
  const app = Fastify({
    logger: logger ? {
      redact: ['req.headers.cookie', 'req.headers.authorization', 'req.body.password', 'res.headers.set-cookie']
    } : false,
    bodyLimit: 4096,
    trustProxy: false
  });

  await app.register(rateLimit, { global: false });

  app.addHook('onRequest', async (request, reply) => {
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method) &&
        request.headers.origin !== config.appOrigin) {
      return reply.code(403).send({ error: 'Forbidden origin' });
    }
  });

  app.get('/api/health', async () => ({ status: 'ok' }));

  app.get('/api/auth/me', async (request, reply) => {
    const owner = ownerForToken(db, sessionFromCookie(request.headers.cookie));
    if (!owner) return reply.code(401).send({ error: 'Authentication required' });
    return { owner };
  });

  app.post('/api/auth/login', {
    config: { rateLimit: { max: 5, timeWindow: '1 minute' } }
  }, async (request, reply) => {
    const body = request.body as { password?: unknown } | null;
    const password = body?.password;
    if (typeof password !== 'string' || password.length === 0 || password.length > 1024) {
      return reply.code(401).send({ error: 'Invalid credentials' });
    }
    const owner = await verifyPassword(db, password);
    if (!owner) return reply.code(401).send({ error: 'Invalid credentials' });
    const token = createSession(db, owner.id);
    reply.header('Set-Cookie', sessionCookie(token, config.isProduction));
    reply.header('Cache-Control', 'no-store');
    return { owner };
  });

  app.post('/api/auth/logout', async (request, reply) => {
    revokeSession(db, sessionFromCookie(request.headers.cookie));
    reply.header('Set-Cookie', clearSessionCookie(config.isProduction));
    reply.header('Cache-Control', 'no-store');
    return { success: true };
  });

  if (serveWeb) {
    await app.register(fastifyStatic, {
      root: path.resolve(process.cwd(), 'apps/web/dist'),
      prefix: '/',
      decorateReply: false
    });
  }
  return app;
}
