import { Router } from 'express';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { ApiError } from '../lib/errors.js';
import { burnPasswordCheck, verifyPassword } from '../lib/password.js';
import { defineRoute } from '../lib/route.js';
import { LoginThrottle, loginRateLimit, MfaAttempts, mfaRateLimit } from '../middleware/rate-limit.js';
import { audit } from '../services/audit.service.js';
import { verifySecondFactor } from '../services/mfa.service.js';
import {
  clearSessionCookie,
  createSession,
  revokeAllSessions,
  revokeSession,
} from '../services/session.service.js';
import {
  findUserByIdentifier,
  getUser,
  normaliseIdentifier,
  serializeUser,
} from '../services/users.service.js';

const UserSchema = z.object({
  id: z.string(),
  username: z.string(),
  email: z.string().nullable(),
  displayName: z.string(),
  mfaEnabled: z.boolean(),
  preferences: z.record(z.string(), z.unknown()),
});

const SessionStateSchema = z.object({
  status: z.enum(['anonymous', 'mfa_required', 'authenticated']),
  user: UserSchema.nullable(),
  csrfToken: z.string().nullable(),
});

// One generic message for every credential failure so responses never reveal whether an account exists.
const INVALID_CREDENTIALS = new ApiError(401, 'INVALID_CREDENTIALS', 'Incorrect username/email or password');

export function authRoutes(ctx: AppContext) {
  const router = Router();
  const p = '/api/auth';
  const throttle = new LoginThrottle(ctx.config.limits.loginPerWindow);
  const mfaAttempts = new MfaAttempts();

  defineRoute(router, p, {
    method: 'get',
    path: '/session',
    tag: 'Auth',
    summary: 'Current session state and CSRF token',
    auth: false,
    response: SessionStateSchema,
    handler: ({ req }) => {
      if (!req.auth) return { status: 'anonymous', user: null, csrfToken: null };
      const { session, user } = req.auth;
      if (session.state === 'mfa_pending')
        return { status: 'mfa_required', user: null, csrfToken: session.csrfToken };
      return { status: 'authenticated', user: serializeUser(user), csrfToken: session.csrfToken };
    },
  });

  defineRoute(router, p, {
    method: 'post',
    path: '/login',
    tag: 'Auth',
    summary: 'Sign in with username/email and password',
    auth: false,
    middleware: [loginRateLimit(ctx)],
    body: z.object({
      identifier: z.string().trim().min(1).max(254),
      password: z.string().min(1).max(256),
    }),
    response: SessionStateSchema,
    handler: async ({ req, res, body }) => {
      const key = normaliseIdentifier(body.identifier);
      const ip = req.ip ?? 'unknown';
      if (throttle.isBlocked(ip, key)) {
        throw new ApiError(
          429,
          'RATE_LIMITED',
          'Too many attempts. Please wait a few minutes and try again.',
        );
      }
      const delay = throttle.delayMs(key);
      if (delay) await new Promise((r) => setTimeout(r, delay));
      const user = findUserByIdentifier(ctx.db, body.identifier);
      const valid = user
        ? await verifyPassword(user.passwordHash, body.password)
        : (await burnPasswordCheck(body.password), false);
      if (!user || !valid) {
        throttle.recordFailure(ip, key);
        audit(ctx.db, req, user?.id ?? null, 'auth.login.failure', { reason: 'credentials' });
        throw INVALID_CREDENTIALS;
      }
      throttle.recordSuccess(ip, key);

      // Session fixation defence: always drop any existing session and mint a new token.
      if (req.auth) revokeSession(ctx, req.auth.session.id, req.auth.user.id);

      if (user.mfaEnabledAt) {
        const session = createSession(ctx, req, res, user.id, 'mfa_pending');
        return { status: 'mfa_required', user: null, csrfToken: session.csrfToken };
      }
      const session = createSession(ctx, req, res, user.id, 'active');
      audit(ctx.db, req, user.id, 'auth.login.success', { mfa: false });
      return { status: 'authenticated', user: serializeUser(user), csrfToken: session.csrfToken };
    },
  });

  defineRoute(router, p, {
    method: 'post',
    path: '/login/mfa',
    tag: 'Auth',
    summary: 'Complete sign-in with a TOTP code or recovery code',
    allowMfaPending: true,
    middleware: [mfaRateLimit(ctx)],
    body: z.object({ code: z.string().trim().min(6).max(20) }),
    response: SessionStateSchema,
    handler: ({ req, res, body, auth }) => {
      if (auth.session.state !== 'mfa_pending')
        throw new ApiError(400, 'BAD_REQUEST', 'No sign-in in progress');
      const user = getUser(ctx.db, auth.user.id)!;
      const method = verifySecondFactor(ctx, user, body.code);
      if (!method) {
        audit(ctx.db, req, user.id, 'auth.mfa.failure');
        // Too many wrong codes: discard the half-finished sign-in; the password is needed again.
        if (mfaAttempts.fail(auth.session.id)) {
          revokeSession(ctx, auth.session.id, user.id);
          clearSessionCookie(ctx, res);
          throw new ApiError(401, 'MFA_ATTEMPTS_EXCEEDED', 'Too many incorrect codes. Please sign in again.');
        }
        throw new ApiError(401, 'INVALID_MFA_CODE', 'That code is not valid');
      }
      mfaAttempts.clear(auth.session.id);
      // Privilege change: replace the pending session with a fresh active one.
      revokeSession(ctx, auth.session.id, user.id);
      const session = createSession(ctx, req, res, user.id, 'active');
      if (method === 'recovery') audit(ctx.db, req, user.id, 'auth.recovery_code_used');
      audit(ctx.db, req, user.id, 'auth.login.success', { mfa: method });
      return { status: 'authenticated', user: serializeUser(user), csrfToken: session.csrfToken };
    },
  });

  defineRoute(router, p, {
    method: 'post',
    path: '/logout',
    tag: 'Auth',
    summary: 'Sign out and revoke the current session',
    allowMfaPending: true,
    status: 204,
    handler: ({ req, res, auth }) => {
      revokeSession(ctx, auth.session.id, auth.user.id);
      clearSessionCookie(ctx, res);
      res.setHeader('Clear-Site-Data', '"cache"');
      audit(ctx.db, req, auth.user.id, 'auth.logout');
    },
  });

  defineRoute(router, p, {
    method: 'post',
    path: '/logout-all',
    tag: 'Auth',
    summary: 'Sign out everywhere (revokes every session, including this one)',
    status: 204,
    handler: ({ req, res, auth }) => {
      const count = revokeAllSessions(ctx, auth.user.id);
      clearSessionCookie(ctx, res);
      res.setHeader('Clear-Site-Data', '"cache"');
      audit(ctx.db, req, auth.user.id, 'auth.logout_all', { revoked: count });
    },
  });

  return router;
}
