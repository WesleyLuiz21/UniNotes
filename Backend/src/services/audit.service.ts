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
