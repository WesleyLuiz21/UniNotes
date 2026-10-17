import { Router } from 'express';
import { buildOpenApi } from '../lib/openapi.js';
import { defineRoute } from '../lib/route.js';

export function openApiRoutes() {
  const router = Router();
  defineRoute(router, '/api', {
    method: 'get',
    path: '/openapi.json',
    tag: 'Meta',
    summary: 'OpenAPI 3.1 description of this API',
    handler: ({ res }) => {
      res.json(buildOpenApi());
    },
  });
  return router;
}
