import path from 'node:path';

export interface AppConfig {
  appOrigin: string;
  databasePath: string;
  host: string;
  port: number;
  isProduction: boolean;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const isProduction = env.NODE_ENV === 'production';
  const origin = env.APP_ORIGIN || (isProduction ? '' : 'http://localhost:5173');
  if (!origin) throw new Error('APP_ORIGIN is required in production');
  let appOrigin: string;
  try {
    const parsed = new URL(origin);
    if (!['https:', 'http:'].includes(parsed.protocol) || parsed.origin !== origin) {
      throw new Error('APP_ORIGIN must be a URL origin with no path');
    }
    if (isProduction && parsed.protocol !== 'https:') {
      throw new Error('APP_ORIGIN must use HTTPS in production');
    }
    appOrigin = parsed.origin;
  } catch (error) {
    throw new Error('Invalid APP_ORIGIN', { cause: error });
  }
  const port = Number(env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be a valid TCP port');
  }
  return {
    appOrigin,
    databasePath: path.resolve(env.DATABASE_PATH || '.data/notetaking.sqlite'),
    host: env.BIND_HOST || '127.0.0.1',
    port,
    isProduction
  };
}
