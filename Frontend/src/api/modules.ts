import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { invalidateNoteLists, qk, queryClient } from '@/lib/queryClient';
import type { Module } from '@/lib/types';

export interface ModuleInput {
  name: string;
  code?: string | null;
  description?: string;
  academicYear?: string | null;
  color?: string;
}

export function useModules(status: 'active' | 'archived' | 'all' = 'active') {
  return useQuery({ queryKey: qk.modules(status), queryFn: () => api.get<Module[]>('/modules', { status }) });
}

export function useModule(id: string | undefined) {
  return useQuery({
    queryKey: qk.module(id ?? ''),
    queryFn: () => api.get<Module>(`/modules/${id}`),
    enabled: Boolean(id),
  });
}

function refresh(m?: Module) {
  if (m) queryClient.setQueryData(qk.module(m.id), m);
  void queryClient.invalidateQueries({ queryKey: ['modules'] });
  invalidateNoteLists();
}

export function useCreateModule() {
  return useMutation({
    mutationFn: (body: ModuleInput) => api.post<Module>('/modules', body),
    onSuccess: refresh,
  });
}

export function useUpdateModule() {
  return useMutation({
    mutationFn: ({ id, ...body }: Partial<ModuleInput> & { id: string }) =>
      api.patch<Module>(`/modules/${id}`, body),
    onSuccess: refresh,
  });
}

export function useArchiveModule() {
  return useMutation({
    mutationFn: ({ id, archived }: { id: string; archived: boolean }) =>
      api.post<Module>(`/modules/${id}/${archived ? 'archive' : 'unarchive'}`),
    onSuccess: refresh,
  });
}

export function useDeleteModule() {
  return useMutation({
    mutationFn: ({ id, confirmName }: { id: string; confirmName: string }) =>
      api.delete<{ notesUnassigned: number }>(`/modules/${id}`, { confirmName }),
    onSuccess: (_d, v) => {
      queryClient.removeQueries({ queryKey: qk.module(v.id) });
      refresh();
    },
  });
}
