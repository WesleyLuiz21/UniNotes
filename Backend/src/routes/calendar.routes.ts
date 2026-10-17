import { Router } from 'express';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { badRequest } from '../lib/errors.js';
import { dateOnly, defineRoute } from '../lib/route.js';

export function calendarRoutes(ctx: AppContext) {
  const router = Router();
  defineRoute(router, '/api', {
    method: 'get',
    path: '/calendar',
    tag: 'Calendar',
    summary: 'Note counts per lecture date in a date range (max 400 days)',
    query: z.object({
      from: dateOnly,
      to: dateOnly,
      moduleId: z.uuid().optional(),
      includeArchived: z.enum(['true', 'false']).optional(),
    }),
    response: z.array(
      z.object({
        date: z.string(),
        count: z.number(),
        modules: z.array(z.object({ id: z.string(), color: z.string(), count: z.number() })),
      }),
    ),
    handler: ({ auth, query }) => {
      if (query.to < query.from) throw badRequest('"to" must not be before "from"');
      const span = (Date.parse(query.to) - Date.parse(query.from)) / 86_400_000;
      if (span > 400) throw badRequest('Date range too large');
      const rows = ctx.db.all<{
        date: string;
        module_id: string | null;
        color: string | null;
        count: number;
      }>(sql`
        SELECT n.lecture_date AS date, n.module_id, m.color, COUNT(*) AS count
        FROM notes n LEFT JOIN modules m ON m.id = n.module_id
        WHERE n.user_id = ${auth.user.id} AND n.deleted_at IS NULL
          ${query.includeArchived === 'true' ? sql`` : sql`AND n.archived_at IS NULL`}
          AND n.lecture_date BETWEEN ${query.from} AND ${query.to}
          ${query.moduleId ? sql`AND n.module_id = ${query.moduleId}` : sql``}
        GROUP BY n.lecture_date, n.module_id
        ORDER BY n.lecture_date`);
      const byDate = new Map<
        string,
        { date: string; count: number; modules: { id: string; color: string; count: number }[] }
      >();
      for (const r of rows) {
        const day = byDate.get(r.date) ?? { date: r.date, count: 0, modules: [] };
        day.count += r.count;
        if (r.module_id) day.modules.push({ id: r.module_id, color: r.color ?? '#3B82F6', count: r.count });
        byDate.set(r.date, day);
      }
      return [...byDate.values()];
    },
  });
  return router;
}
