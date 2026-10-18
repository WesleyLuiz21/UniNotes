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

/** Sliding-window failure counter (in-memory; appropriate for this single-instance deployment). */
class FailureWindow {
  private entries = new Map<string, { count: number; firstAt: number }>();
  constructor(private readonly windowMs: number) {}

  count(key: string, now = Date.now()) {
    const e = this.entries.get(key);
    if (!e) return 0;
    if (now - e.firstAt > this.windowMs) {
      this.entries.delete(key);
      return 0;
    }
    return e.count;
  }

  add(key: string, now = Date.now()) {
    const e = this.entries.get(key);
    if (!e || now - e.firstAt > this.windowMs) this.entries.set(key, { count: 1, firstAt: now });
    else e.count++;
    if (this.entries.size > 50_000) this.prune(now);
  }

  reset(key: string) {
    this.entries.delete(key);
  }

  private prune(now: number) {
    for (const [k, e] of this.entries) if (now - e.firstAt > this.windowMs) this.entries.delete(k);
  }
}

/**
 * Login throttling designed so an attacker can NOT lock the real owner out:
 *  - Hard limit per (client IP, account): stops a single source from guessing.
 *  - Account-wide failures (from any IP) only add a growing delay (capped at 5 s) — they never
 *    block, so a distributed attacker cannot deny the owner access, while large-scale guessing
 *    against one account is slowed down (on top of Argon2's cost and optional MFA).
 */
export class LoginThrottle {
  private perSource: FailureWindow;
  private perAccount: FailureWindow;

  constructor(
    private readonly maxPerSource = 10,
    windowMs = 15 * 60_000,
    private readonly accountGrace = 20,
  ) {
    this.perSource = new FailureWindow(windowMs);
    this.perAccount = new FailureWindow(windowMs);
  }

  isBlocked(ip: string, account: string) {
    return this.perSource.count(`${ip}|${account}`) >= this.maxPerSource;
  }

  /** Delay to apply before verifying a password for this account. */
  delayMs(account: string) {
    const n = this.perAccount.count(account);
    return n <= this.accountGrace ? 0 : Math.min(5000, (n - this.accountGrace) * 250);
  }

  recordFailure(ip: string, account: string) {
    this.perSource.add(`${ip}|${account}`);
    this.perAccount.add(account);
  }

  recordSuccess(ip: string, account: string) {
    this.perSource.reset(`${ip}|${account}`);
  }
}

/** Counts wrong second-factor codes per pending session (the session is revoked at the limit). */
export class MfaAttempts {
  private window = new FailureWindow(15 * 60_000);
  constructor(readonly max = 5) {}
  fail(sessionId: string) {
    this.window.add(sessionId);
    return this.window.count(sessionId) >= this.max;
  }
  clear(sessionId: string) {
    this.window.reset(sessionId);
  }
}

/** Coarse limit for unauthenticated API traffic (scanners, floods). Signed-in requests are exempt. */
export const anonymousApiLimit = () =>
  rateLimit({
    windowMs: 5 * 60_000,
    limit: 300,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    skip: (req: Request) => Boolean(req.auth),
    message: tooMany,
  });
