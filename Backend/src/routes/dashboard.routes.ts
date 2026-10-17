import { Router } from 'express';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { dateOnly, defineRoute } from '../lib/route.js';
import { listModules } from '../services/modules.service.js';
import { queryNotes } from '../services/notes.service.js';

export function dashboardRoutes(ctx: AppContext) {
  const router = Router();
  defineRoute(router, '/api', {
    method: 'get',
    path: '/dashboard',
    tag: 'Dashboard',
    summary: 'Dashboard summary: recent notes, modules and activity stats',
    // The client sends its local week start so "this week" matches the user's calendar.
    query: z.object({ weekStart: dateOnly.optional() }),
    handler: ({ auth, query }) => {
      const userId = auth.user.id;
      const weekStart = query.weekStart ?? new Date(Date.now() - 6 * 86_400_000).toISOString().slice(0, 10);
      const stats = ctx.db.get<{ total: number; this_week: number; favourites: number }>(sql`
        SELECT COUNT(*) AS total,
          SUM(CASE WHEN substr(created_at, 1, 10) >= ${weekStart} THEN 1 ELSE 0 END) AS this_week,
          SUM(is_favourite) AS favourites
        FROM notes WHERE user_id = ${userId} AND deleted_at IS NULL AND archived_at IS NULL`);
      const active = ctx.db.get<{ id: string; name: string; color: string }>(sql`
        SELECT m.id, m.name, m.color FROM notes n JOIN modules m ON m.id = n.module_id
        WHERE n.user_id = ${userId} AND n.deleted_at IS NULL
        ORDER BY n.updated_at DESC LIMIT 1`);
      const modules = listModules(ctx.db, userId, 'active');
      const recent = queryNotes(ctx.db, userId, {
        status: 'active',
        sort: 'updated',
        tags: [],
        page: 1,
        pageSize: 6,
      });
      return {
        stats: {
          totalNotes: stats?.total ?? 0,
          totalModules: modules.length,
          notesThisWeek: stats?.this_week ?? 0,
          favourites: stats?.favourites ?? 0,
          recentlyActiveModule: active ?? null,
        },
        recentNotes: recent.items,
        modules,
      };
    },
  });
  return router;
}
