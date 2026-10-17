import type { NextFunction, Request, RequestHandler, Response, Router } from 'express';
import { z } from 'zod';
import type { AuthContext } from '../middleware/auth.js';
import { ApiError, unauthorized } from './errors.js';

/**
 * Typed route declaration. Every endpoint is declared through `defineRoute`, which:
 *  - validates params, query and body with Zod before the handler runs,
 *  - enforces authentication unless `auth: false`,
 *  - wraps JSON results in the standard `{ data, meta? }` envelope,
 *  - records the route in the OpenAPI registry, so the published contract cannot drift.
 */

type AnyZod = z.ZodType;
type Infer<T> = T extends AnyZod ? z.output<T> : undefined;

export interface RouteSpec<
  P extends AnyZod | undefined,
  Q extends AnyZod | undefined,
  B extends AnyZod | undefined,
> {
  method: 'get' | 'post' | 'patch' | 'put' | 'delete';
  path: string;
  summary: string;
  tag: string;
  auth?: boolean;
  /** Allow sessions that have passed the password step but not MFA yet. */
  allowMfaPending?: boolean;
  params?: P;
  query?: Q;
  body?: B;
  /** Documentation only: shape of `data` in a JSON response. */
  response?: AnyZod;
  /** Documentation only: non-JSON response content type (e.g. a file download). */
  produces?: string;
  /** Documentation only: multipart form fields. */
  multipart?: Record<string, 'file' | 'string'>;
  status?: number;
  middleware?: RequestHandler[];
  handler: (ctx: HandlerContext<Infer<P>, Infer<Q>, Infer<B>>) => unknown;
}

export interface HandlerContext<P, Q, B> {
  req: Request;
  res: Response;
  params: P;
  query: Q;
  body: B;
  /** Present on authenticated routes. */
  auth: AuthContext;
}

/** Return this from a handler to include pagination or other metadata. */
export class WithMeta<T> {
  constructor(
    readonly data: T,
    readonly meta: Record<string, unknown>,
  ) {}
}

export interface RegisteredRoute {
  method: string;
  path: string;
  summary: string;
  tag: string;
  auth: boolean;
  params?: AnyZod;
  query?: AnyZod;
  body?: AnyZod;
  response?: AnyZod;
  produces?: string;
  multipart?: Record<string, 'file' | 'string'>;
  status: number;
}

export const routeRegistry: RegisteredRoute[] = [];

function parseOrThrow(schema: AnyZod, value: unknown, where: string) {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new ApiError(
      400,
      'VALIDATION_ERROR',
      `Invalid ${where}`,
      result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    );
  }
  return result.data;
}

export function defineRoute<
  P extends AnyZod | undefined = undefined,
  Q extends AnyZod | undefined = undefined,
  B extends AnyZod | undefined = undefined,
>(router: Router, prefix: string, spec: RouteSpec<P, Q, B>) {
  const auth = spec.auth ?? true;
  const fullPath = prefix + spec.path;
  if (!routeRegistry.some((r) => r.method === spec.method && r.path === fullPath)) {
    routeRegistry.push({
      method: spec.method,
      path: fullPath,
      summary: spec.summary,
      tag: spec.tag,
      auth,
      params: spec.params,
      query: spec.query,
      body: spec.body,
      response: spec.response,
      produces: spec.produces,
      multipart: spec.multipart,
      status: spec.status ?? 200,
    });
  }

  const handler = async (req: Request, res: Response, _next: NextFunction) => {
    if (auth) {
      const ctx = req.auth;
      if (!ctx || (ctx.session.state !== 'active' && !spec.allowMfaPending)) throw unauthorized();
    }
    const params = spec.params ? parseOrThrow(spec.params, req.params, 'path parameters') : undefined;
    const query = spec.query ? parseOrThrow(spec.query, req.query, 'query parameters') : undefined;
    const body = spec.body ? parseOrThrow(spec.body, req.body ?? {}, 'request body') : undefined;
    const result = await spec.handler({
      req,
      res,
      params: params as Infer<P>,
      query: query as Infer<Q>,
      body: body as Infer<B>,
      auth: req.auth as AuthContext,
    });
    if (res.headersSent || res.writableEnded) return;
    const status = spec.status ?? 200;
    if (status === 204) {
      res.status(204).end();
    } else if (result instanceof WithMeta) {
      res.status(status).json({ data: result.data, meta: result.meta });
    } else {
      res.status(status).json({ data: result ?? null });
    }
  };

  router[spec.method](fullPath, ...(spec.middleware ?? []), handler);
}

// ---------- Shared schema helpers ----------

export const idParam = z.object({ id: z.uuid() });

export const dateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD')
  .refine((v) => {
    const d = new Date(`${v}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
  }, 'Invalid calendar date');

export const pagination = {
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
};

/** Query-string boolean ("true"/"false"/"1"/"0"). */
export const queryBool = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1');
