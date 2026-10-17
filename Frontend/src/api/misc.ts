import { useQuery } from '@tanstack/react-query';
import { format, startOfWeek } from 'date-fns';
import { api } from '@/lib/api';
import { qk } from '@/lib/queryClient';
import type { CalendarDay, Dashboard } from '@/lib/types';

export function useDashboard() {
  const weekStart = format(startOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd');
  return useQuery({ queryKey: qk.dashboard, queryFn: () => api.get<Dashboard>('/dashboard', { weekStart }) });
}

export function useCalendar(from: string, to: string, moduleId?: string) {
  return useQuery({
    queryKey: qk.calendar(from, to, moduleId),
    queryFn: () => api.get<CalendarDay[]>('/calendar', { from, to, moduleId }),
  });
}

export function useTags() {
  return useQuery({ queryKey: qk.tags, queryFn: () => api.get<{ name: string; count: number }[]>('/tags') });
}
