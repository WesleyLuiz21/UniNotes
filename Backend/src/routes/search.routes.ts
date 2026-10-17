import { Router } from 'express';
import type { AppContext } from '../context.js';
import { defineRoute, WithMeta } from '../lib/route.js';
import { NoteQuerySchema, queryNotes } from '../services/notes.service.js';

export function searchRoutes(ctx: AppContext) {
  const router = Router();
  defineRoute(router, '/api', {
    method: 'get',
    path: '/search',
    tag: 'Search',
    summary:
      'Full-text search (FTS5) over titles, content, tags and module names, with filters. Snippet highlights are delimited by \\u0001 and \\u0002.',
    query: NoteQuerySchema,
    handler: ({ auth, query }) => {
      const { items, ...meta } = queryNotes(ctx.db, auth.user.id, query);
      return new WithMeta(items, meta);
    },
  });
  return router;
}
