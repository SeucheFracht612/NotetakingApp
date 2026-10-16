import { createOwner } from '../auth.js';
import { loadConfig } from '../config.js';
import { openDatabase } from '../db.js';

function hiddenPrompt(label: string): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY || !process.stdout.isTTY || !process.stdin.setRawMode) {
      reject(new Error('Run this command interactively in a TTY. Do not pass passwords as arguments.'));
      return;
    }
    let value = '';
    process.stdout.write(label);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
    const cleanup = () => {
      process.stdin.off('data', onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write('\n');
    };
    const onData = (chunk: string) => {
      for (const character of chunk) {
        if (character === '\r' || character === '\n') {
          cleanup();
          resolve(value);
          return;
        }
        if (character === '\u0003') {
          cleanup();
          reject(new Error('Cancelled'));
          return;
        }
        if (character === '\u007f') {
          value = value.slice(0, -1);
        } else if (character >= ' ' && character !== '\u007f') {
          value += character;
        }
      }
    };
    process.stdin.on('data', onData);
  });
}

const db = openDatabase(loadConfig().databasePath);
try {
  if (db.prepare('SELECT 1 FROM owners LIMIT 1').get()) {
    throw new Error('An owner already exists. Setup can only be performed once.');
  }
  const password = await hiddenPrompt('New owner password (12+ characters): ');
  const confirmation = await hiddenPrompt('Confirm password: ');
  if (password !== confirmation) throw new Error('Passwords do not match');
  await createOwner(db, password);
  process.stdout.write('Owner account created. You can now sign in.\n');
} catch (error) {
  process.stderr.write(String(error) + '\n');
  process.exitCode = 1;
} finally {
  db.close();
}
