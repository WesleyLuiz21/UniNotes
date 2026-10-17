import { Router } from 'express';
import { and, eq, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { users } from '../db/schema.js';
import { badRequest, conflict } from '../lib/errors.js';
import { hashPassword, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '../lib/password.js';
import { defineRoute } from '../lib/route.js';
import { nowIso } from '../lib/time.js';
import { sensitiveRateLimit } from '../middleware/rate-limit.js';
import { audit, listAuditEvents } from '../services/audit.service.js';
import {
  beginMfaSetup,
  confirmMfaSetup,
  disableMfa,
  reauthenticate,
  remainingRecoveryCodes,
  replaceRecoveryCodes,
} from '../services/mfa.service.js';
import {
  createSession,
  listSessions,
  publicSessionId,
  revokeAllSessions,
  revokeSession,
} from '../services/session.service.js';
import {
  getUser,
  normaliseIdentifier,
  parsePreferences,
  PreferencesSchema,
  serializeUser,
  UsernameSchema,
} from '../services/users.service.js';

export const NewPasswordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Use at least ${PASSWORD_MIN_LENGTH} characters`)
  .max(PASSWORD_MAX_LENGTH);

const ReauthBody = z.object({
  currentPassword: z.string().min(1).max(PASSWORD_MAX_LENGTH),
  code: z.string().trim().max(20).optional(),
});

export function settingsRoutes(ctx: AppContext) {
  const router = Router();
  const p = '/api/settings';
  const { db } = ctx;
  const sensitive = sensitiveRateLimit();

  // ---------- Account ----------

  defineRoute(router, p, {
    method: 'get',
    path: '/account',
    tag: 'Settings',
    summary: 'Current account',
    handler: ({ auth }) => serializeUser(auth.user),
  });

  defineRoute(router, p, {
    method: 'patch',
    path: '/account',
    tag: 'Settings',
    summary: 'Update account details (changing username or email requires the current password)',
    middleware: [sensitive],
    body: z.object({
      displayName: z.string().trim().min(1).max(100).optional(),
      username: UsernameSchema.optional(),
      email: z.union([z.email().max(254), z.literal('')]).optional(),
      currentPassword: z.string().max(PASSWORD_MAX_LENGTH).optional(),
      code: z.string().trim().max(20).optional(),
    }),
    handler: async ({ req, auth, body }) => {
      const user = getUser(db, auth.user.id)!;
      const username = body.username !== undefined ? normaliseIdentifier(body.username) : undefined;
      const email =
        body.email !== undefined ? (body.email ? normaliseIdentifier(body.email) : null) : undefined;
      const identifierChange =
        (username !== undefined && username !== user.username) ||
        (email !== undefined && email !== user.email);
      if (identifierChange) {
        await reauthenticate(ctx, user, body.currentPassword ?? '', body.code);
        const clash = db
          .select({ id: users.id })
          .from(users)
          .where(
            and(
              ne(users.id, user.id),
              sql`(${users.username} IN (${username ?? ''}, ${email ?? ''}) OR ${users.email} IN (${username ?? ''}, ${email ?? ''}))`,
            ),
          )
          .get();
        if (clash) throw conflict('IDENTIFIER_TAKEN', 'That username or email is not available');
      }
      db.update(users)
        .set({
          ...(body.displayName !== undefined ? { displayName: body.displayName } : {}),
          ...(username !== undefined ? { username } : {}),
          ...(email !== undefined ? { email } : {}),
          updatedAt: nowIso(),
        })
        .where(eq(users.id, user.id))
        .run();
      audit(db, req, user.id, 'account.updated', { identifierChanged: identifierChange });
      return serializeUser(getUser(db, user.id)!);
    },
  });

  defineRoute(router, p, {
    method: 'patch',
    path: '/preferences',
    tag: 'Settings',
    summary: 'Update UI preferences (theme, editor)',
    body: PreferencesSchema.partial(),
    handler: ({ auth, body }) => {
      const prefs = { ...parsePreferences(getUser(db, auth.user.id)!.preferences), ...body };
      db.update(users)
        .set({ preferences: JSON.stringify(prefs), updatedAt: nowIso() })
        .where(eq(users.id, auth.user.id))
        .run();
      return prefs;
    },
  });

  // ---------- Security ----------

  defineRoute(router, p, {
    method: 'get',
    path: '/security',
    tag: 'Settings',
    summary: 'Security overview: MFA status and active sessions',
    handler: ({ auth }) => ({
      mfaEnabled: Boolean(auth.user.mfaEnabledAt),
      recoveryCodesRemaining: auth.user.mfaEnabledAt ? remainingRecoveryCodes(ctx, auth.user.id) : 0,
      passwordChangedAt: auth.user.passwordChangedAt,
      sessions: listSessions(ctx, auth.user.id)
        .map((s) => ({
          id: publicSessionId(s),
          current: s.id === auth.session.id,
          ip: s.ip,
          userAgent: s.userAgent,
          createdAt: s.createdAt,
          lastSeenAt: s.lastSeenAt,
          expiresAt: s.expiresAt,
        }))
        .sort((a, b) => Number(b.current) - Number(a.current) || b.lastSeenAt.localeCompare(a.lastSeenAt)),
    }),
  });

  defineRoute(router, p, {
    method: 'get',
    path: '/security/events',
    tag: 'Settings',
    summary: 'Recent security events for this account',
    handler: ({ auth }) => listAuditEvents(db, auth.user.id, 50),
  });

  defineRoute(router, p, {
    method: 'delete',
    path: '/security/sessions/:sessionId',
    tag: 'Settings',
    summary: 'Revoke one of your sessions',
    params: z.object({ sessionId: z.string().regex(/^[0-9a-f]{64}$/) }),
    status: 204,
    handler: ({ req, auth, params }) => {
      if (params.sessionId === auth.session.id) throw badRequest('Use sign out to end the current session');
      revokeSession(ctx, params.sessionId, auth.user.id);
      audit(db, req, auth.user.id, 'auth.session_revoked');
    },
  });

  defineRoute(router, p, {
    method: 'post',
    path: '/security/password',
    tag: 'Settings',
    summary: 'Change password (signs out all other sessions and rotates this one)',
    middleware: [sensitive],
    body: ReauthBody.extend({ newPassword: NewPasswordSchema }),
    handler: async ({ req, res, auth, body }) => {
      const user = getUser(db, auth.user.id)!;
      await reauthenticate(ctx, user, body.currentPassword, body.code);
      if (body.newPassword === body.currentPassword)
        throw badRequest('Choose a password different from the current one');
      if (body.newPassword.toLowerCase().includes(user.username))
        throw badRequest('Password must not contain your username');
      const now = nowIso();
      db.update(users)
        .set({ passwordHash: await hashPassword(body.newPassword), passwordChangedAt: now, updatedAt: now })
        .where(eq(users.id, user.id))
        .run();
      revokeAllSessions(ctx, user.id);
      const session = createSession(ctx, req, res, user.id, 'active');
      audit(db, req, user.id, 'auth.password_changed');
      return { csrfToken: session.csrfToken };
    },
  });

  defineRoute(router, p, {
    method: 'post',
    path: '/security/mfa/setup',
    tag: 'Settings',
    summary: 'Begin TOTP enrolment (requires current password); returns secret and QR code',
    middleware: [sensitive],
    body: z.object({ currentPassword: z.string().min(1).max(PASSWORD_MAX_LENGTH) }),
    handler: async ({ auth, body }) => {
      const user = getUser(db, auth.user.id)!;
      if (user.mfaEnabledAt) throw badRequest('MFA is already enabled');
      await reauthenticate(ctx, user, body.currentPassword);
      return beginMfaSetup(ctx, user);
    },
  });

  defineRoute(router, p, {
    method: 'post',
    path: '/security/mfa/enable',
    tag: 'Settings',
    summary: 'Confirm TOTP enrolment with a code; returns one-time recovery codes',
    middleware: [sensitive],
    body: z.object({
      code: z
        .string()
        .trim()
        .regex(/^\d{6}$/, 'Enter the 6-digit code'),
    }),
    handler: ({ req, auth, body }) => {
      const user = getUser(db, auth.user.id)!;
      if (user.mfaEnabledAt) throw badRequest('MFA is already enabled');
      const recoveryCodes = confirmMfaSetup(ctx, user, body.code);
      // Other sessions were authenticated without MFA; end them.
      revokeAllSessions(ctx, user.id, auth.session.id);
      audit(db, req, user.id, 'auth.mfa_enabled');
      return { recoveryCodes };
    },
  });

  defineRoute(router, p, {
    method: 'post',
    path: '/security/mfa/disable',
    tag: 'Settings',
    summary: 'Disable MFA (requires password and a current code or recovery code)',
    middleware: [sensitive],
    body: ReauthBody,
    status: 204,
    handler: async ({ req, auth, body }) => {
      const user = getUser(db, auth.user.id)!;
      if (!user.mfaEnabledAt) throw badRequest('MFA is not enabled');
      await reauthenticate(ctx, user, body.currentPassword, body.code);
      disableMfa(ctx, user.id);
      audit(db, req, user.id, 'auth.mfa_disabled');
    },
  });

  defineRoute(router, p, {
    method: 'post',
    path: '/security/mfa/recovery-codes',
    tag: 'Settings',
    summary: 'Regenerate recovery codes (invalidates the old ones)',
    middleware: [sensitive],
    body: ReauthBody,
    handler: async ({ req, auth, body }) => {
      const user = getUser(db, auth.user.id)!;
      if (!user.mfaEnabledAt) throw badRequest('MFA is not enabled');
      await reauthenticate(ctx, user, body.currentPassword, body.code);
      const recoveryCodes = replaceRecoveryCodes(ctx, user.id);
      audit(db, req, user.id, 'auth.recovery_codes_regenerated');
      return { recoveryCodes };
    },
  });

  // ---------- Data ----------

  defineRoute(router, p, {
    method: 'get',
    path: '/data',
    tag: 'Settings',
    summary: 'Storage and content statistics',
    handler: ({ auth }) => {
      const uid = auth.user.id;
      const stats = db.get<{ active: number; archived: number; deleted: number; versions: number }>(sql`
        SELECT
          (SELECT COUNT(*) FROM notes WHERE user_id = ${uid} AND deleted_at IS NULL AND archived_at IS NULL) AS active,
          (SELECT COUNT(*) FROM notes WHERE user_id = ${uid} AND deleted_at IS NULL AND archived_at IS NOT NULL) AS archived,
          (SELECT COUNT(*) FROM notes WHERE user_id = ${uid} AND deleted_at IS NOT NULL) AS deleted,
          (SELECT COUNT(*) FROM note_versions WHERE user_id = ${uid}) AS versions`);
      const att = db.get<{ count: number; bytes: number | null }>(
        sql`SELECT COUNT(*) AS count, SUM(size_bytes) AS bytes FROM attachments WHERE user_id = ${uid}`,
      );
      return {
        notes: { active: stats?.active ?? 0, archived: stats?.archived ?? 0, deleted: stats?.deleted ?? 0 },
        versions: stats?.versions ?? 0,
        attachments: { count: att?.count ?? 0, bytes: att?.bytes ?? 0 },
        limits: {
          imageBytes: ctx.config.limits.imageBytes,
          attachmentBytes: ctx.config.limits.attachmentBytes,
          importBytes: ctx.config.limits.importBytes,
        },
      };
    },
  });

  return router;
}
