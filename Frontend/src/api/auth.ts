import { useMutation, useQuery } from '@tanstack/react-query';
import { api, setCsrfToken } from '@/lib/api';
import { qk, queryClient } from '@/lib/queryClient';
import type { SessionState } from '@/lib/types';

export async function fetchSession() {
  const s = await api.get<SessionState>('/auth/session');
  setCsrfToken(s.csrfToken);
  return s;
}

export function useSession() {
  return useQuery({ queryKey: qk.session, queryFn: fetchSession, staleTime: 5 * 60_000 });
}

function acceptSession(s: SessionState) {
  setCsrfToken(s.csrfToken);
  queryClient.setQueryData(qk.session, s);
}

export function useLogin() {
  return useMutation({
    mutationFn: (body: { identifier: string; password: string }) =>
      api.post<SessionState>('/auth/login', body),
    onSuccess: acceptSession,
  });
}

export function useMfaLogin() {
  return useMutation({
    mutationFn: (code: string) => api.post<SessionState>('/auth/login/mfa', { code }),
    onSuccess: acceptSession,
  });
}

/** Clear all cached private data when the session ends. */
export function resetClientState() {
  setCsrfToken(null);
  queryClient.clear();
  queryClient.setQueryData(qk.session, {
    status: 'anonymous',
    user: null,
    csrfToken: null,
  } satisfies SessionState);
}

export function useLogout() {
  return useMutation({
    mutationFn: (all: boolean = false) => api.post<void>(all ? '/auth/logout-all' : '/auth/logout'),
    onSettled: resetClientState,
  });
}
