import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router';
import type { NoteFilters } from '@/lib/types';

const KEYS = [
  'q',
  'status',
  'moduleId',
  'academicYear',
  'date',
  'from',
  'to',
  'tags',
  'favourite',
  'updatedWithinDays',
  'sort',
  'page',
] as const;

/** Note filters stored in the URL query string. Any filter change resets to page 1. */
export function useUrlFilters(defaults: Partial<NoteFilters> = {}) {
  const [params, setParams] = useSearchParams();
  const filters = useMemo(() => {
    const f: Record<string, unknown> = { ...defaults };
    for (const k of KEYS) {
      const v = params.get(k);
      if (v !== null && v !== '') f[k] = k === 'page' || k === 'updatedWithinDays' ? Number(v) : v;
    }
    return f as NoteFilters;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  const update = useCallback(
    (patch: Partial<NoteFilters>) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [k, v] of Object.entries(patch)) {
            if (v === undefined || v === null || v === '') next.delete(k);
            else next.set(k, String(v));
          }
          if (!('page' in patch)) next.delete('page');
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );
  return [filters, update] as const;
}
