import type { NextFunction, Request, Response } from 'express';
import type { AppContext } from '../context.js';
import { ApiError } from '../lib/errors.js';
import { safeEqual } from '../lib/crypto.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF defence for cookie-authenticated, state-changing requests (OWASP-recommended layering):
 *  1. Origin verification: browsers send Origin on cross-site POST/PATCH/DELETE; it must match
 *     APP_ORIGIN. Sec-Fetch-Site provides the same signal on modern browsers.
 *  2. Synchronizer token: requests carrying a session must echo the session's CSRF token in the
 *     X-CSRF-Token header, which a cross-site attacker cannot read.
 *  SameSite=Lax cookies are a third, browser-side layer.
 */
export function csrfProtection(ctx: AppContext) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (SAFE_METHODS.has(req.method)) return next();

    const origin = req.get('origin');
    const fetchSite = req.get('sec-fetch-site');
    if (origin && origin !== ctx.config.origin) {
      return next(new ApiError(403, 'CSRF_ORIGIN_MISMATCH', 'Cross-origin request rejected'));
    }
    if (!origin && fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') {
      return next(new ApiError(403, 'CSRF_ORIGIN_MISMATCH', 'Cross-site request rejected'));
    }

    if (req.auth) {
      const token = req.get('x-csrf-token') ?? '';
      if (!token || !safeEqual(token, req.auth.session.csrfToken)) {
        return next(new ApiError(403, 'CSRF_TOKEN_INVALID', 'Missing or invalid CSRF token'));
      }
    }
    next();
  };
}
