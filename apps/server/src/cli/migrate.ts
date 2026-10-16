import { loadConfig } from '../config.js';
import { openDatabase } from '../db.js';

const db = openDatabase(loadConfig().databasePath);
db.close();
process.stdout.write('Database migrations complete.\n');
