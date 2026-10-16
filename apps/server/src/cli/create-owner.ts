import { createOwner } from '../auth.js';
import { loadConfig } from '../config.js';
import { openDatabase } from '../db.js';

/**
 * Prompt for a password in a real interactive terminal without echoing it.
 * The whole password stays local to the terminal process; never pass it as
 * an argument or environment variable.
 */
function hiddenPrompt(label: string): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY || !process.stdout.isTTY || !process.stdin.setRawMode) {
      reject(new Error('Run this command in an interactive terminal (TTY).'));
      return;
    }

    let value = '';
    const previousRaw = process.stdin.isRaw ?? false;
    const cleanup = () => {
      process.stdin.off('data', onData);
      process.stdin.setRawMode(previousRaw);
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
        if (character === '\u0003' || character === '\u0004') {
          cleanup();
          reject(new Error('Owner setup cancelled'));
          return;
        }
        if (character === '\u007f' || character === '\b') {
          value = Array.from(value).slice(0, -1).join('');
        } else if (character >= ' ' && character !== '\u007f') {
          value += character;
        }
      }
    };

    process.stdout.write(label);
    process.stdin.setRawMode(true);
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', onData);
    process.stdin.resume();
  });
}

const db = openDatabase(loadConfig().databasePath);
try {
  if (db.prepare('SELECT 1 FROM owners LIMIT 1').get()) {
    throw new Error('An owner already exists. Setup can only be performed once.');
  }

  process.stdout.write('Owner setup (your input will be hidden; no characters appear as you type).\n');
  // Validate before requesting confirmation. Permit retries without restarting.
  while (true) {
    const password = await hiddenPrompt('New owner password (at least 12 characters): ');
    const length = Array.from(password).length;
    if (length < 12) {
      process.stderr.write('Password is too short (at least 12 characters). Please try again.\n');
      continue;
    }
    if (password.length > 1024) {
      process.stderr.write('Password is too long. Please choose a shorter password.\n');
      continue;
    }
    const confirmation = await hiddenPrompt('Confirm owner password: ');
    if (password !== confirmation) {
      process.stderr.write('Passwords did not match. Please try again.\n');
      continue;
    }
    await createOwner(db, password);
    process.stdout.write('Owner account created successfully. You can now sign in.\n');
    break;
  }
} catch (error) {
  process.stderr.write(String(error) + '\n');
  process.exitCode = 1;
} finally {
  db.close();
}
