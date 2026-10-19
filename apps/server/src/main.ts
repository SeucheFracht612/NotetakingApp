import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { openDatabase } from './db.js';

const config = loadConfig();
const db = openDatabase(config.databasePath);
const app = await buildApp({ db, config, serveWeb: config.isProduction, logger: true });

async function stop(): Promise<void> {
  await app.close();
  db.close();
}

process.once('SIGINT', () => { void stop().then(() => process.exit(0)); });
process.once('SIGTERM', () => { void stop().then(() => process.exit(0)); });

try {
  await app.listen({ host: config.host, port: config.port });
} catch (error) {
  app.log.error(error);
  await stop();
  process.exitCode = 1;
}
