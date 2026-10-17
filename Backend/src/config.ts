import path from 'node:path';
import { z } from 'zod';

const bool = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1');

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  HOST: z.string().default('0.0.0.0'),
  DATA_DIR: z.string().default('./data'),
  DATABASE_PATH: z.string().optional(),
  ATTACHMENTS_DIR: z.string().optional(),
  BACKUP_DIR: z.string().optional(),
  APP_SECRET_KEY: z
    .string()
    .min(32, 'APP_SECRET_KEY must be at least 32 characters (use: openssl rand -base64 32)'),
  APP_ORIGIN: z.url(),
  COOKIE_SECURE: bool.optional(),
  TRUST_PROXY: z.string().default('loopback, linklocal, uniquelocal'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  SESSION_IDLE_DAYS: z.coerce.number().positive().default(7),
  SESSION_ABSOLUTE_DAYS: z.coerce.number().positive().default(30),
  LOGIN_RATE_LIMIT: z.coerce.number().int().positive().default(10),
  MAX_IMAGE_MB: z.coerce.number().positive().default(10),
  MAX_ATTACHMENT_MB: z.coerce.number().positive().default(25),
  MAX_IMPORT_MB: z.coerce.number().positive().default(2),
  MIGRATE_ON_START: bool.default(false),
  VERSION_RETENTION: z.coerce.number().int().min(5).default(100),
  VERSION_INTERVAL_MINUTES: z.coerce.number().min(0).default(10),
  RECYCLE_BIN_RETENTION_DAYS: z.coerce.number().int().min(0).default(0),
});

export type Config = ReturnType<typeof loadConfig>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid backend configuration:\n${issues}`);
  }
  const e = parsed.data;
  const dataDir = path.resolve(e.DATA_DIR);
  const cookieSecure = e.COOKIE_SECURE ?? e.NODE_ENV === 'production';
  const origin = new URL(e.APP_ORIGIN).origin;
  return {
    env: e.NODE_ENV,
    isProduction: e.NODE_ENV === 'production',
    port: e.PORT,
    host: e.HOST,
    origin,
    secretKey: e.APP_SECRET_KEY,
    trustProxy: e.TRUST_PROXY,
    logLevel: e.LOG_LEVEL,
    migrateOnStart: e.MIGRATE_ON_START,
    paths: {
      dataDir,
      database: path.resolve(e.DATABASE_PATH ?? path.join(dataDir, 'db', 'uninotes.db')),
      attachments: path.resolve(e.ATTACHMENTS_DIR ?? path.join(dataDir, 'attachments')),
      backups: path.resolve(e.BACKUP_DIR ?? path.join(dataDir, 'backups')),
    },
    session: {
      // __Host- prefix forces Secure, Path=/ and no Domain, which is what we want in production.
      cookieName: cookieSecure ? '__Host-uninotes_sid' : 'uninotes_sid',
      cookieSecure,
      idleMs: e.SESSION_IDLE_DAYS * 86_400_000,
      absoluteMs: e.SESSION_ABSOLUTE_DAYS * 86_400_000,
      mfaPendingMs: 10 * 60_000,
    },
    limits: {
      loginPerWindow: e.LOGIN_RATE_LIMIT,
      imageBytes: Math.round(e.MAX_IMAGE_MB * 1024 * 1024),
      attachmentBytes: Math.round(e.MAX_ATTACHMENT_MB * 1024 * 1024),
      importBytes: Math.round(e.MAX_IMPORT_MB * 1024 * 1024),
      jsonBody: '2mb',
      maxMarkdownChars: 1_000_000,
    },
    recycleBinRetentionDays: e.RECYCLE_BIN_RETENTION_DAYS,
    versions: {
      retention: e.VERSION_RETENTION,
      intervalMs: e.VERSION_INTERVAL_MINUTES * 60_000,
    },
  };
}
