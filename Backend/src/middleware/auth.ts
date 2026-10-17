import type { NextFunction, Request, Response } from 'express';
import { parseCookie } from 'cookie';
import type { AppContext } from '../context.js';
import type { Session, User } from '../db/schema.js';
import { validateSessionToken } from '../services/session.service.js';

export interface AuthContext {
  user: User;
  session: Session;
}

declare module 'express-serve-static-core' {
  interface Request {
    auth?: AuthContext;
  }
}

/** Attach the session (if any) to the request. Authorisation is enforced per route. */
export function loadSession(ctx: AppContext) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const header = req.headers.cookie;
    if (header) {
      const token = parseCookie(header)[ctx.config.session.cookieName];
      if (token) {
        const result = validateSessionToken(ctx, token);
        if (result) req.auth = result;
      }
    }
    next();
  };
}
