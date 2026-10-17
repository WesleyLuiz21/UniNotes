/**
 * Minimal fetch wrapper for the UniNotes REST API.
 * - Same-origin requests with cookies (HttpOnly session; never stored in JS).
 * - Adds the CSRF token header to every state-changing request.
 * - Unwraps the { data, meta } envelope and throws ApiError for { error } responses.
 */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

let csrfToken: string | null = null;
export const setCsrfToken = (token: string | null) => {
  csrfToken = token;
};

type UnauthorizedListener = () => void;
const unauthorizedListeners = new Set<UnauthorizedListener>();
/** Notified when an authenticated request returns 401 (session expired or revoked). */
export function onUnauthorized(fn: UnauthorizedListener) {
  unauthorizedListeners.add(fn);
  return () => {
    unauthorizedListeners.delete(fn);
  };
}

type Query = Record<string, string | number | boolean | undefined | null>;

export function buildUrl(path: string, query?: Query) {
  const url = `/api${path}`;
  if (!query) return url;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== '') params.set(k, String(v));
  }
  const qs = params.toString();
  return qs ? `${url}?${qs}` : url;
}

interface RequestOptions {
  query?: Query;
  body?: unknown;
  form?: FormData;
  signal?: AbortSignal;
}

export async function apiRequest<T>(
  method: string,
  path: string,
  opts: RequestOptions = {},
): Promise<{ data: T; meta?: Record<string, unknown> }> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  let body: BodyInit | undefined;
  if (opts.form) body = opts.form;
  else if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }
  if (method !== 'GET' && csrfToken) headers['X-CSRF-Token'] = csrfToken;

  let res: Response;
  try {
    res = await fetch(buildUrl(path, opts.query), {
      method,
      headers,
      body,
      credentials: 'same-origin',
      signal: opts.signal,
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    throw new ApiError(0, 'NETWORK_ERROR', 'Cannot reach the server. Check your connection.');
  }

  if (res.status === 204) return { data: undefined as T };
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    /* non-JSON error page from a proxy */
  }
  if (!res.ok) {
    const err = (json as { error?: { code: string; message: string; details?: unknown } } | null)?.error;
    if (res.status === 401 && !path.startsWith('/auth/')) unauthorizedListeners.forEach((fn) => fn());
    throw new ApiError(
      res.status,
      err?.code ?? 'HTTP_ERROR',
      err?.message ?? `Request failed (${res.status})`,
      err?.details,
    );
  }
  return json as { data: T; meta?: Record<string, unknown> };
}

export const api = {
  get: async <T>(path: string, query?: Query, signal?: AbortSignal) =>
    (await apiRequest<T>('GET', path, { query, signal })).data,
  getPaged: async <T>(path: string, query?: Query, signal?: AbortSignal) => {
    const res = await apiRequest<T[]>('GET', path, { query, signal });
    return { items: res.data, ...(res.meta as { total: number; page: number; pageSize: number }) };
  },
  post: async <T>(path: string, body?: unknown) =>
    (await apiRequest<T>('POST', path, { body: body ?? {} })).data,
  patch: async <T>(path: string, body: unknown) => (await apiRequest<T>('PATCH', path, { body })).data,
  delete: async <T = void>(path: string, body?: unknown) =>
    (await apiRequest<T>('DELETE', path, { body })).data,
  upload: async <T>(path: string, form: FormData) => (await apiRequest<T>('POST', path, { form })).data,
};

export const errorMessage = (err: unknown, fallback = 'Something went wrong') =>
  err instanceof ApiError ? err.message : err instanceof Error ? err.message : fallback;
