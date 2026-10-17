import { QueryClient } from '@tanstack/react-query';
import { ApiError } from './api';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: false, // no background polling; data is invalidated after mutations
      retry: (count, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
    },
    mutations: { retry: false },
  },
});

export const qk = {
  session: ['session'] as const,
  dashboard: ['dashboard'] as const,
  modules: (status = 'active') => ['modules', status] as const,
  module: (id: string) => ['module', id] as const,
  notes: (filters: object) => ['notes', filters] as const,
  note: (id: string) => ['note', id] as const,
  versions: (id: string) => ['versions', id] as const,
  version: (noteId: string, id: string) => ['version', noteId, id] as const,
  attachments: (noteId: string) => ['attachments', noteId] as const,
  search: (filters: object) => ['search', filters] as const,
  calendar: (from: string, to: string, moduleId?: string) => ['calendar', from, to, moduleId ?? ''] as const,
  tags: ['tags'] as const,
  security: ['security'] as const,
  securityEvents: ['security-events'] as const,
  dataStats: ['data-stats'] as const,
};

/** Invalidate everything derived from notes (lists, search, calendar, dashboard). */
export function invalidateNoteLists() {
  for (const key of ['notes', 'search', 'calendar', 'dashboard', 'modules', 'module', 'tags', 'data-stats']) {
    void queryClient.invalidateQueries({ queryKey: [key] });
  }
}
