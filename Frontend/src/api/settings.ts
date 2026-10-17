import { useMutation, useQuery } from '@tanstack/react-query';
import { api, setCsrfToken } from '@/lib/api';
import { qk, queryClient } from '@/lib/queryClient';
import type { AuditEvent, DataStats, Preferences, SecurityOverview, SessionState, User } from '@/lib/types';

function updateSessionUser(user: User) {
  queryClient.setQueryData<SessionState>(qk.session, (s) => (s ? { ...s, user } : s));
}

export function useUpdateAccount() {
  return useMutation({
    mutationFn: (body: {
      displayName?: string;
      username?: string;
      email?: string;
      currentPassword?: string;
      code?: string;
    }) => api.patch<User>('/settings/account', body),
    onSuccess: updateSessionUser,
  });
}

export function useUpdatePreferences() {
  return useMutation({
    mutationFn: (body: Partial<Preferences>) => api.patch<Preferences>('/settings/preferences', body),
    onSuccess: (preferences) =>
      queryClient.setQueryData<SessionState>(qk.session, (s) =>
        s?.user ? { ...s, user: { ...s.user, preferences } } : s,
      ),
  });
}

export function useSecurity() {
  return useQuery({
    queryKey: qk.security,
    queryFn: () => api.get<SecurityOverview>('/settings/security'),
    staleTime: 0,
  });
}

export function useSecurityEvents() {
  return useQuery({
    queryKey: qk.securityEvents,
    queryFn: () => api.get<AuditEvent[]>('/settings/security/events'),
    staleTime: 0,
  });
}

const refreshSecurity = () => {
  void queryClient.invalidateQueries({ queryKey: qk.security });
  void queryClient.invalidateQueries({ queryKey: qk.securityEvents });
  void queryClient.invalidateQueries({ queryKey: qk.session });
};

export function useChangePassword() {
  return useMutation({
    mutationFn: (body: { currentPassword: string; newPassword: string; code?: string }) =>
      api.post<{ csrfToken: string }>('/settings/security/password', body),
    onSuccess: ({ csrfToken }) => {
      setCsrfToken(csrfToken);
      refreshSecurity();
    },
  });
}

export function useRevokeSession() {
  return useMutation({
    mutationFn: (id: string) => api.delete(`/settings/security/sessions/${id}`),
    onSuccess: refreshSecurity,
  });
}

export function useMfaSetup() {
  return useMutation({
    mutationFn: (currentPassword: string) =>
      api.post<{ secret: string; otpauthUri: string; qrSvg: string }>('/settings/security/mfa/setup', {
        currentPassword,
      }),
  });
}

export function useMfaEnable() {
  return useMutation({
    mutationFn: (code: string) =>
      api.post<{ recoveryCodes: string[] }>('/settings/security/mfa/enable', { code }),
    onSuccess: refreshSecurity,
  });
}

export function useMfaDisable() {
  return useMutation({
    mutationFn: (body: { currentPassword: string; code: string }) =>
      api.post<void>('/settings/security/mfa/disable', body),
    onSuccess: refreshSecurity,
  });
}

export function useRegenerateRecoveryCodes() {
  return useMutation({
    mutationFn: (body: { currentPassword: string; code: string }) =>
      api.post<{ recoveryCodes: string[] }>('/settings/security/mfa/recovery-codes', body),
    onSuccess: refreshSecurity,
  });
}

export function useDataStats() {
  return useQuery({
    queryKey: qk.dataStats,
    queryFn: () => api.get<DataStats>('/settings/data'),
    staleTime: 0,
  });
}
