import type { Request, Response } from 'express';
import { and, eq, lt, ne, or } from 'drizzle-orm';
import type { AppContext } from '../context.js';
import { sessions, users, type Session, type User } from '../db/schema.js';
import { randomToken, sha256Hex } from '../lib/crypto.js';
import { isoAfter, nowIso } from '../lib/time.js';
import { clientMeta } from './audit.service.js';

/**
 * Server-side sessions.
 * - The cookie holds a 256-bit random token; the DB stores only SHA-256(token) as the session id,
 *   so a database leak does not reveal usable session tokens.
 * - Sessions have a sliding idle expiry and a hard absolute expiry.
 * - A new token is issued on every privilege change (login, MFA completion, password change).
 * - Each session has its own CSRF synchronizer token.
 */

const SLIDING_UPDATE_INTERVAL_MS = 60_000;

export function createSession(
  ctx: AppContext,
  req: Request,
  res: Response,
  userId: string,
  state: Session['state'],
) {
  const token = randomToken(32);
  const now = Date.now();
  const { ip, userAgent } = clientMeta(req);
  const idleMs = state === 'active' ? ctx.config.session.idleMs : ctx.config.session.mfaPendingMs;
  const absoluteMs = state === 'active' ? ctx.config.session.absoluteMs : ctx.config.session.mfaPendingMs;
  const row = {
    id: sha256Hex(token),
    userId,
    state,
    csrfToken: randomToken(32),
    ip,
    userAgent,
    createdAt: new Date(now).toISOString(),
    lastSeenAt: new Date(now).toISOString(),
    expiresAt: isoAfter(idleMs, now),
    absoluteExpiresAt: isoAfter(absoluteMs, now),
  };
  ctx.db.insert(sessions).values(row).run();
  setSessionCookie(ctx, res, token, absoluteMs);
  return row;
}

export function setSessionCookie(ctx: AppContext, res: Response, token: string, maxAgeMs: number) {
  res.cookie(ctx.config.session.cookieName, token, {
    httpOnly: true,
    secure: ctx.config.session.cookieSecure,
    sameSite: 'lax',
    path: '/',
    maxAge: maxAgeMs,
  });
}

export function clearSessionCookie(ctx: AppContext, res: Response) {
  res.clearCookie(ctx.config.session.cookieName, {
    httpOnly: true,
    secure: ctx.config.session.cookieSecure,
    sameSite: 'lax',
    path: '/',
  });
}

/** Resolve a cookie token to a live session and its user, extending the idle window. */
export function validateSessionToken(
  ctx: AppContext,
  token: string,
): { session: Session; user: User } | null {
  if (!token || token.length > 128) return null;
  const id = sha256Hex(token);
  const row = ctx.db
    .select({ session: sessions, user: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.id, id))
    .get();
  if (!row) return null;
  const now = Date.now();
  const { session } = row;
  if (Date.parse(session.expiresAt) <= now || Date.parse(session.absoluteExpiresAt) <= now) {
    ctx.db.delete(sessions).where(eq(sessions.id, id)).run();
    return null;
  }
  if (session.state === 'active' && now - Date.parse(session.lastSeenAt) > SLIDING_UPDATE_INTERVAL_MS) {
    const expiresAt = new Date(
      Math.min(now + ctx.config.session.idleMs, Date.parse(session.absoluteExpiresAt)),
    ).toISOString();
    const lastSeenAt = new Date(now).toISOString();
    ctx.db.update(sessions).set({ lastSeenAt, expiresAt }).where(eq(sessions.id, id)).run();
    session.lastSeenAt = lastSeenAt;
    session.expiresAt = expiresAt;
  }
  return row;
}

export function revokeSession(ctx: AppContext, sessionId: string, userId: string) {
  return ctx.db
    .delete(sessions)
    .where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId)))
    .run().changes;
}

export function revokeAllSessions(ctx: AppContext, userId: string, exceptSessionId?: string) {
  const where = exceptSessionId
    ? and(eq(sessions.userId, userId), ne(sessions.id, exceptSessionId))
    : eq(sessions.userId, userId);
  return ctx.db.delete(sessions).where(where).run().changes;
}

export function listSessions(ctx: AppContext, userId: string) {
  return ctx.db
    .select()
    .from(sessions)
    .where(and(eq(sessions.userId, userId), eq(sessions.state, 'active')))
    .all();
}

export function purgeExpiredSessions(ctx: AppContext) {
  const now = nowIso();
  return ctx.db
    .delete(sessions)
    .where(or(lt(sessions.expiresAt, now), lt(sessions.absoluteExpiresAt, now)))
    .run().changes;
}

/**
 * Public id of a session. It is SHA-256(token), so exposing it to the owner lets the UI
 * address sessions without ever revealing a usable credential.
 */
export const publicSessionId = (s: Session) => s.id;
