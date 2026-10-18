import express from 'express';
import { pinoHttp } from 'pino-http';
import type { AppContext } from './context.js';
import { loadSession } from './middleware/auth.js';
import { csrfProtection } from './middleware/csrf.js';
import { anonymousApiLimit } from './middleware/rate-limit.js';
import { errorHandler, notFoundHandler } from './middleware/errors.js';
import { apiSecurityHeaders, noStore } from './middleware/security.js';
import { attachmentRoutes } from './routes/attachments.routes.js';
import { authRoutes } from './routes/auth.routes.js';
import { calendarRoutes } from './routes/calendar.routes.js';
import { dashboardRoutes } from './routes/dashboard.routes.js';
import { exportRoutes } from './routes/export.routes.js';
import { healthRoutes } from './routes/health.routes.js';
import { importRoutes } from './routes/import.routes.js';
import { moduleRoutes } from './routes/modules.routes.js';
import { noteRoutes } from './routes/notes.routes.js';
import { openApiRoutes } from './routes/openapi.routes.js';
import { searchRoutes } from './routes/search.routes.js';
import { settingsRoutes } from './routes/settings.routes.js';
import { tagRoutes } from './routes/tags.routes.js';

export function createApp(ctx: AppContext) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', ctx.config.trustProxy);
  app.set('query parser', 'simple');

  app.use(
    pinoHttp({
      logger: ctx.logger,
      // Health checks are frequent and uninteresting.
      autoLogging: { ignore: (req) => req.url === '/api/health' },
      serializers: {
        req: (req: { method: string; url: string; id: unknown }) => ({
          id: req.id,
          method: req.method,
          url: req.url.split('?')[0],
        }),
        res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
      },
    }),
  );
  app.use(apiSecurityHeaders());
  app.use('/api', noStore);
  // No CORS headers are emitted: the frontend is same-origin (proxy in dev and production),
  // so browsers block cross-origin reads by default.
  app.use(loadSession(ctx));
  // Anonymous clients can only reach login-type endpoints, so they get a tiny body limit.
  const jsonSignedIn = express.json({ limit: ctx.config.limits.jsonBody, strict: true });
  const jsonAnonymous = express.json({ limit: '16kb', strict: true });
  app.use((req, res, next) => (req.auth ? jsonSignedIn : jsonAnonymous)(req, res, next));
  app.use('/api', anonymousApiLimit());
  app.use('/api', csrfProtection(ctx));

  app.use(healthRoutes(ctx));
  app.use(authRoutes(ctx));
  app.use(settingsRoutes(ctx));
  app.use(moduleRoutes(ctx));
  app.use(noteRoutes(ctx));
  app.use(tagRoutes(ctx));
  app.use(calendarRoutes(ctx));
  app.use(searchRoutes(ctx));
  app.use(dashboardRoutes(ctx));
  app.use(attachmentRoutes(ctx));
  app.use(importRoutes(ctx));
  app.use(exportRoutes(ctx));
  app.use(openApiRoutes());

  app.use(notFoundHandler);
  app.use(errorHandler(ctx.logger));
  return app;
}
