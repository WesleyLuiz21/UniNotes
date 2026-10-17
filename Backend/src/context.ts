import type { Config } from './config.js';
import type { DB } from './db/client.js';
import type { Logger } from './logger.js';
import { SecretBox } from './lib/crypto.js';

/** Dependencies shared by routes and services; built once in server.ts (or per test). */
export interface AppContext {
  config: Config;
  db: DB;
  logger: Logger;
  secretBox: SecretBox;
}

export function createContext(config: Config, db: DB, logger: Logger): AppContext {
  return { config, db, logger, secretBox: new SecretBox(config.secretKey) };
}
