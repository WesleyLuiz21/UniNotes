import { Router } from 'express';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { defineRoute } from '../lib/route.js';
import { listTags } from '../services/tags.service.js';

export function tagRoutes(ctx: AppContext) {
  const router = Router();
  defineRoute(router, '/api', {
    method: 'get',
    path: '/tags',
    tag: 'Tags',
    summary: 'List tags in use with note counts',
    response: z.array(z.object({ name: z.string(), count: z.number() })),
    handler: ({ auth }) => listTags(ctx.db, auth.user.id),
  });
  return router;
}
