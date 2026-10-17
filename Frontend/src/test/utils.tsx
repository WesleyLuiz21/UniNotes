import type { ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '@/lib/queryClient';
import { render } from '@testing-library/react';
import { createMemoryRouter, RouterProvider, type RouteObject } from 'react-router';
import { vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/misc';
import { ThemeProvider } from '@/lib/theme';

type Handler = (url: URL, init: RequestInit) => { status?: number; body?: unknown } | undefined;

/** Stub fetch with a simple router: handlers return { status, body } (body wrapped in { data }). */
export function mockApi(handler: Handler) {
  const calls: { method: string; url: URL; body: unknown; headers: Record<string, string> }[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input), 'http://localhost');
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : init.body;
    calls.push({
      method: init.method ?? 'GET',
      url,
      body,
      headers: (init.headers ?? {}) as Record<string, string>,
    });
    const res = handler(url, init) ?? {
      status: 404,
      body: { error: { code: 'NOT_FOUND', message: 'Not found' } },
    };
    const status = res.status ?? 200;
    if (status === 204) return new Response(null, { status });
    const payload = status >= 400 ? res.body : { data: res.body };
    return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });
  });
  vi.stubGlobal('fetch', fetchMock);
  return { fetchMock, calls };
}

export const authedSession = {
  status: 'authenticated',
  csrfToken: 'csrf-test',
  user: {
    id: 'u1',
    username: 'student',
    email: 's@example.com',
    displayName: 'Sam Student',
    mfaEnabled: false,
    passwordChangedAt: '2025-01-01T00:00:00.000Z',
    createdAt: '2025-01-01T00:00:00.000Z',
    preferences: {
      theme: 'light',
      editorFontSize: 14,
      editorLineWrap: true,
      sidebarCollapsed: false,
      lastModuleId: null,
    },
  },
};

export function renderRoutes(routes: RouteObject[], initialEntries: string[] = ['/']) {
  // Use the app's client: API hooks write to it directly (e.g. after login).
  const client = queryClient;
  client.clear();
  client.setDefaultOptions({
    queries: { retry: false, staleTime: 30_000, refetchOnWindowFocus: false },
    mutations: { retry: false },
  });
  const router = createMemoryRouter(routes, { initialEntries });
  const utils = render(
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <TooltipProvider>
          <RouterProvider router={router} />
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>,
  );
  return { ...utils, router, client };
}

export function renderWithProviders(ui: ReactNode, path = '/') {
  return renderRoutes([{ path: '*', element: ui }], [path]);
}
