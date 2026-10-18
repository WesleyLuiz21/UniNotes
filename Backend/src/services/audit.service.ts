import type { Request } from 'express';
import { and, desc, eq, lt } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import { auditEvents } from '../db/schema.js';
import { newId } from '../lib/crypto.js';
import { nowIso } from '../lib/time.js';

export type AuditType =
  | 'auth.login.success'
  | 'auth.login.failure'
  | 'auth.mfa.failure'
  | 'auth.logout'
  | 'auth.logout_all'
  | 'auth.session_revoked'
  | 'auth.password_changed'
  | 'auth.mfa_enabled'
  | 'auth.mfa_disabled'
  | 'auth.recovery_codes_regenerated'
  | 'auth.recovery_code_used'
  | 'account.updated'
  | 'notes.permanently_deleted'
  | 'module.deleted'
  | 'data.exported'
  | 'data.imported';

export function clientMeta(req: Request) {
  return { ip: req.ip ?? null, userAgent: (req.get('user-agent') ?? '').slice(0, 300) || null };
}

/** Record a security-relevant event. Never pass secrets in `details`. */
export function audit(
  db: DB,
  req: Request | null,
  userId: string | null,
  type: AuditType,
  details: object = {},
) {
  const meta = req ? clientMeta(req) : { ip: null, userAgent: null };
  db.insert(auditEvents)
    .values({ id: newId(), userId, type, ...meta, details: JSON.stringify(details), createdAt: nowIso() })
    .run();
}

export function listAuditEvents(db: DB, userId: string, limit = 50, before?: string) {
  const where = before
    ? and(eq(auditEvents.userId, userId), lt(auditEvents.createdAt, before))
    : eq(auditEvents.userId, userId);
  return db
    .select()
    .from(auditEvents)
    .where(where)
    .orderBy(desc(auditEvents.createdAt))
    .limit(limit)
    .all()
    .map((e) => ({ ...e, details: JSON.parse(e.details) as Record<string, unknown> }));
}

/**
 * Retention: failed sign-in records (which anonymous clients can generate) are kept 90 days,
 * everything else 2 years, so the table cannot grow without bound.
 */
export function pruneAuditEvents(db: DB, now = Date.now()) {
  const failures = new Date(now - 90 * 86_400_000).toISOString();
  const others = new Date(now - 730 * 86_400_000).toISOString();
  return db.$client
    .prepare(
      `DELETE FROM audit_events WHERE (type IN ('auth.login.failure', 'auth.mfa.failure') AND created_at < ?) OR created_at < ?`,
    )
    .run(failures, others).changes;
}
