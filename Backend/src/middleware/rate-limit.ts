import type { Request } from 'express';
import { rateLimit, ipKeyGenerator } from 'express-rate-limit';
import type { AppContext } from '../context.js';

const tooMany = {
  error: { code: 'RATE_LIMITED', message: 'Too many attempts. Please wait a few minutes and try again.' },
};

/** Per-IP limit on login attempts; only failed attempts count. */
export const loginRateLimit = (ctx: AppContext) =>
  rateLimit({
    windowMs: 15 * 60_000,
    limit: ctx.config.limits.loginPerWindow,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    message: tooMany,
  });

/** MFA codes have a small keyspace; limit guesses per IP (in addition to the pending-session TTL). */
export const mfaRateLimit = (ctx: AppContext) =>
  rateLimit({
    windowMs: 15 * 60_000,
    limit: Math.max(5, ctx.config.limits.loginPerWindow),
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    message: tooMany,
  });

/** Sensitive re-authentication endpoints (password change, MFA changes). */
export const sensitiveRateLimit = () =>
  rateLimit({
    windowMs: 15 * 60_000,
    limit: 20,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator: (req: Request) => req.auth?.user.id ?? ipKeyGenerator(req.ip ?? ''),
    message: tooMany,
  });

/**
 * Per-account failure counter so a distributed attacker cannot bypass the per-IP limit.
 * In-memory is appropriate for this single-instance deployment.
 */
export class AccountLockout {
  private failures = new Map<string, { count: number; firstAt: number }>();

  constructor(
    private readonly maxFailures = 10,
    private readonly windowMs = 15 * 60_000,
  ) {}

  isLocked(key: string, now = Date.now()) {
    const entry = this.failures.get(key);
    if (!entry) return false;
    if (now - entry.firstAt > this.windowMs) {
      this.failures.delete(key);
      return false;
    }
    return entry.count >= this.maxFailures;
  }

  recordFailure(key: string, now = Date.now()) {
    const entry = this.failures.get(key);
    if (!entry || now - entry.firstAt > this.windowMs) this.failures.set(key, { count: 1, firstAt: now });
    else entry.count++;
  }

  reset(key: string) {
    this.failures.delete(key);
  }
}
