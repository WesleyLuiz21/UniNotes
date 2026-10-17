/** Writes openapi.json from the live route registry: npm run openapi */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { createContext } from '../src/context.js';
import { openDatabase } from '../src/db/client.js';
import { createLogger } from '../src/logger.js';
import { buildOpenApi } from '../src/lib/openapi.js';

const config = loadConfig({
  APP_SECRET_KEY: 'x'.repeat(32),
  APP_ORIGIN: 'http://localhost',
  DATA_DIR: '/tmp',
} as NodeJS.ProcessEnv);
createApp(createContext(config, openDatabase(':memory:'), createLogger('silent')));
const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'openapi.json');
fs.writeFileSync(out, `${JSON.stringify(buildOpenApi(), null, 2)}\n`);
console.log(`Wrote ${out}`);
