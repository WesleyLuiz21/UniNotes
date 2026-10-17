import { z } from 'zod';
import { routeRegistry, type RegisteredRoute } from './route.js';

const toJson = (schema: z.ZodType, io: 'input' | 'output') => {
  const { $schema: _ignored, ...rest } = z.toJSONSchema(schema, { io, unrepresentable: 'any' }) as Record<
    string,
    unknown
  >;
  return rest;
};

function parameters(route: RegisteredRoute) {
  const out: object[] = [];
  for (const [where, schema] of [
    ['path', route.params],
    ['query', route.query],
  ] as const) {
    if (!schema) continue;
    const json = toJson(schema, 'input') as { properties?: Record<string, object>; required?: string[] };
    for (const [name, prop] of Object.entries(json.properties ?? {})) {
      out.push({
        name,
        in: where,
        required: where === 'path' || (json.required ?? []).includes(name),
        schema: prop,
      });
    }
  }
  return out;
}

const ErrorSchema = {
  type: 'object',
  properties: {
    error: {
      type: 'object',
      properties: { code: { type: 'string' }, message: { type: 'string' }, details: {} },
      required: ['code', 'message'],
    },
  },
};

/** Build the OpenAPI 3.1 document from the routes registered via defineRoute. */
export function buildOpenApi() {
  const paths: Record<string, Record<string, object>> = {};
  for (const r of routeRegistry) {
    const p = r.path.replace(/:(\w+)/g, '{$1}');
    const op: Record<string, unknown> = {
      summary: r.summary,
      tags: [r.tag],
      operationId: `${r.method}${p.replace(/[{}]/g, '').replace(/[^a-zA-Z0-9]+(.)?/g, (_m, c: string | undefined) => (c ? c.toUpperCase() : ''))}`,
      parameters: parameters(r),
      responses: {} as Record<string, unknown>,
    };
    if (!r.auth) op.security = [];
    if (r.multipart) {
      op.requestBody = {
        required: true,
        content: {
          'multipart/form-data': {
            schema: {
              type: 'object',
              properties: Object.fromEntries(
                Object.entries(r.multipart).map(([k, t]) => [
                  k,
                  t === 'file' ? { type: 'string', format: 'binary' } : { type: 'string' },
                ]),
              ),
            },
          },
        },
      };
    } else if (r.body) {
      op.requestBody = {
        required: true,
        content: { 'application/json': { schema: toJson(r.body, 'input') } },
      };
    }
    const responses = op.responses as Record<string, unknown>;
    if (r.status === 204) responses['204'] = { description: 'No content' };
    else if (r.produces)
      responses[String(r.status)] = {
        description: 'File',
        content: { [r.produces]: { schema: { type: 'string', format: 'binary' } } },
      };
    else {
      const data = r.response ? toJson(r.response, 'output') : {};
      responses[String(r.status)] = {
        description: 'Success',
        content: {
          'application/json': { schema: { type: 'object', properties: { data, meta: { type: 'object' } } } },
        },
      };
    }
    responses['400'] = { $ref: '#/components/responses/Error' };
    if (r.auth) responses['401'] = { $ref: '#/components/responses/Error' };
    if (r.method !== 'get')
      responses['403'] = { description: 'CSRF/origin check failed', $ref: '#/components/responses/Error' };
    (paths[p] ??= {})[r.method] = op;
  }
  return {
    openapi: '3.1.0',
    info: {
      title: 'UniNotes API',
      version: '1.0.0',
      description:
        'REST API for UniNotes. Authentication uses an HttpOnly session cookie. State-changing requests from a ' +
        'signed-in session must send the X-CSRF-Token header (value from GET /api/auth/session). Successful JSON ' +
        'responses are wrapped as { data, meta? }; errors as { error: { code, message, details? } }.',
    },
    servers: [{ url: '/' }],
    security: [{ sessionCookie: [], csrfToken: [] }],
    components: {
      securitySchemes: {
        sessionCookie: { type: 'apiKey', in: 'cookie', name: '__Host-uninotes_sid' },
        csrfToken: { type: 'apiKey', in: 'header', name: 'X-CSRF-Token' },
      },
      responses: {
        Error: { description: 'Error', content: { 'application/json': { schema: ErrorSchema } } },
      },
    },
    paths,
  };
}
