import fs from 'node:fs';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createContext } from './context.js';
import { openDatabase } from './db/client.js';
import { migrationStatus, runMigrations } from './db/migrations.js';
import { createLogger } from './logger.js';
import { purgeExpiredSessions } from './services/session.service.js';
import { purgeRecycleBin } from './services/notes.service.js';

const config = loadConfig();
const logger = createLogger(config.logLevel);

fs.mkdirSync(config.paths.attachments, { recursive: true });
const db = openDatabase(config.paths.database);

const status = migrationStatus(db);
if (status.pending.length > 0) {
  if (config.migrateOnStart) {
    logger.warn({ pending: status.pending }, 'Applying pending migrations (MIGRATE_ON_START=true)');
    runMigrations(db);
  } else {
    logger.fatal(
      { pending: status.pending },
      'Database has pending migrations. Back up, then run: docker compose run --rm backend npm run db:migrate:prod',
    );
    process.exit(1);
  }
}

const ctx = createContext(config, db, logger);
const app = createApp(ctx);

const server = app.listen(config.port, config.host, () => {
  logger.info({ port: config.port, env: config.env }, 'UniNotes backend listening');
});
server.requestTimeout = 120_000;
server.headersTimeout = 30_000;

const maintenance = () => {
  try {
    purgeExpiredSessions(ctx);
    purgeRecycleBin(ctx);
    db.$client.pragma('wal_checkpoint(PASSIVE)');
  } catch (err) {
    logger.error({ err }, 'Maintenance task failed');
  }
};
maintenance();
const timer = setInterval(maintenance, 60 * 60_000);
timer.unref();

function shutdown(signal: string) {
  logger.info({ signal }, 'Shutting down');
  server.close(() => {
    db.$client.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
