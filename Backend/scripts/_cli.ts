import readline from 'node:readline';
import { Writable } from 'node:stream';
import { loadConfig } from '../src/config.js';
import { openDatabase } from '../src/db/client.js';

export function cliContext() {
  const config = loadConfig();
  const db = openDatabase(config.paths.database);
  return { config, db };
}

export function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return undefined;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : '';
}
export const flag = (name: string) => process.argv.includes(`--${name}`);

export async function prompt(question: string, opts: { hidden?: boolean } = {}): Promise<string> {
  let muted = false;
  const output = new Writable({
    write(chunk, _enc, cb) {
      if (!muted) process.stdout.write(chunk);
      cb();
    },
  });
  const rl = readline.createInterface({ input: process.stdin, output, terminal: process.stdin.isTTY });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      if (opts.hidden) process.stdout.write('\n');
      resolve(answer);
    });
    muted = Boolean(opts.hidden);
  });
}

/** Read a password from stdin (for --password-stdin) without echoing it anywhere. */
export async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  return Buffer.concat(chunks)
    .toString('utf8')
    .replace(/\r?\n$/, '');
}

export function fail(message: string): never {
  console.error(`Error: ${message}`);
  process.exit(1);
}
