import { Router } from 'express';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { defineRoute } from '../lib/route.js';

/** Liveness/readiness. Deliberately reveals nothing beyond "ok" and DB reachability. */
export function healthRoutes(ctx: AppContext) {
  const router = Router();
  defineRoute(router, '/api', {
    method: 'get',
    path: '/health',
    tag: 'Health',
    summary: 'Service health check',
    auth: false,
    response: z.object({ status: z.literal('ok'), database: z.literal('ok') }),
    handler: ({ res }) => {
      try {
        ctx.db.$client.prepare('SELECT 1').get();
      } catch {
        res.status(503).json({ data: { status: 'unavailable', database: 'error' } });
        return;
      }
      return { status: 'ok', database: 'ok' };
    },
  });
  return router;
}
