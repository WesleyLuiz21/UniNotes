import { X } from 'lucide-react';
import { useModules } from '@/api/modules';
import { useTags } from '@/api/misc';
import { Button } from '@/components/ui/button';
import { Input, Label, NativeSelect } from '@/components/ui/input';
import type { NoteFilters as Filters } from '@/lib/types';

export const SORT_OPTIONS: { value: NonNullable<Filters['sort']>; label: string }[] = [
  { value: 'updated', label: 'Recently modified' },
  { value: 'lecture_desc', label: 'Newest lecture date' },
  { value: 'lecture_asc', label: 'Oldest lecture date' },
  { value: 'title', label: 'Alphabetical' },
];

/**
 * Filter controls shared by the Notes, Module and Search pages. State lives in the URL so
 * filtered views can be bookmarked and survive reloads.
 */
export function NoteFilters({
  value,
  onChange,
  hide = [],
  allowRelevance,
}: {
  value: Filters;
  onChange: (patch: Partial<Filters>) => void;
  hide?: ('module' | 'year' | 'status')[];
  allowRelevance?: boolean;
}) {
  const { data: modules } = useModules('all');
  const { data: tags } = useTags();
  const years = [...new Set((modules ?? []).map((m) => m.academicYear).filter(Boolean))] as string[];
  const active = Boolean(
    value.moduleId ||
    value.academicYear ||
    value.from ||
    value.to ||
    value.tags ||
    value.favourite ||
    value.updatedWithinDays ||
    (value.status && value.status !== 'active'),
  );

  return (
    <div className="border-border bg-surface grid gap-3 rounded-lg border p-3 sm:grid-cols-2 lg:grid-cols-4">
      {!hide.includes('module') && (
        <div className="grid gap-1">
          <Label htmlFor="f-module" className="text-muted-foreground text-xs">
            Module
          </Label>
          <NativeSelect
            id="f-module"
            value={value.moduleId ?? ''}
            onChange={(e) => onChange({ moduleId: e.target.value || undefined })}
          >
            <option value="">All modules</option>
            <option value="none">No module</option>
            {modules?.map((m) => (
              <option key={m.id} value={m.id}>
                {m.code ? `${m.code} · ` : ''}
                {m.name}
                {m.archivedAt ? ' (archived)' : ''}
              </option>
            ))}
          </NativeSelect>
        </div>
      )}
      {!hide.includes('year') && (
        <div className="grid gap-1">
          <Label htmlFor="f-year" className="text-muted-foreground text-xs">
            Academic year
          </Label>
          <NativeSelect
            id="f-year"
            value={value.academicYear ?? ''}
            onChange={(e) => onChange({ academicYear: e.target.value || undefined })}
          >
            <option value="">Any year</option>
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </NativeSelect>
        </div>
      )}
      <div className="grid gap-1">
        <Label htmlFor="f-from" className="text-muted-foreground text-xs">
          Lecture date from
        </Label>
        <Input
          id="f-from"
          type="date"
          value={value.from ?? ''}
          onChange={(e) => onChange({ from: e.target.value || undefined })}
        />
      </div>
      <div className="grid gap-1">
        <Label htmlFor="f-to" className="text-muted-foreground text-xs">
          Lecture date to
        </Label>
        <Input
          id="f-to"
          type="date"
          value={value.to ?? ''}
          onChange={(e) => onChange({ to: e.target.value || undefined })}
        />
      </div>
      <div className="grid gap-1">
        <Label htmlFor="f-tag" className="text-muted-foreground text-xs">
          Tag
        </Label>
        <NativeSelect
          id="f-tag"
          value={value.tags ?? ''}
          onChange={(e) => onChange({ tags: e.target.value || undefined })}
        >
          <option value="">Any tag</option>
          {tags?.map((t) => (
            <option key={t.name} value={t.name}>
              #{t.name} ({t.count})
            </option>
          ))}
        </NativeSelect>
      </div>
      <div className="grid gap-1">
        <Label htmlFor="f-modified" className="text-muted-foreground text-xs">
          Modified
        </Label>
        <NativeSelect
          id="f-modified"
          value={value.updatedWithinDays ?? ''}
          onChange={(e) =>
            onChange({ updatedWithinDays: e.target.value ? Number(e.target.value) : undefined })
          }
        >
          <option value="">Any time</option>
          <option value="1">Last 24 hours</option>
          <option value="7">Last 7 days</option>
          <option value="30">Last 30 days</option>
        </NativeSelect>
      </div>
      {!hide.includes('status') && (
        <div className="grid gap-1">
          <Label htmlFor="f-status" className="text-muted-foreground text-xs">
            Status
          </Label>
          <NativeSelect
            id="f-status"
            value={value.status ?? 'active'}
            onChange={(e) => onChange({ status: e.target.value as Filters['status'] })}
          >
            <option value="active">Active</option>
            <option value="archived">Archived</option>
            <option value="all">Active and archived</option>
          </NativeSelect>
        </div>
      )}
      <div className="grid gap-1">
        <Label htmlFor="f-sort" className="text-muted-foreground text-xs">
          Sort by
        </Label>
        <NativeSelect
          id="f-sort"
          value={value.sort ?? (allowRelevance ? 'relevance' : 'updated')}
          onChange={(e) => onChange({ sort: e.target.value as Filters['sort'] })}
        >
          {allowRelevance && <option value="relevance">Best match</option>}
          {SORT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </NativeSelect>
      </div>
      <div className="flex items-end gap-3 sm:col-span-2 lg:col-span-4">
        <label className="flex h-9 items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-4 accent-[var(--accent)]"
            checked={value.favourite === 'true'}
            onChange={(e) => onChange({ favourite: e.target.checked ? 'true' : undefined })}
          />
          Favourites only
        </label>
        {active && (
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto"
            onClick={() =>
              onChange({
                moduleId: undefined,
                academicYear: undefined,
                from: undefined,
                to: undefined,
                tags: undefined,
                favourite: undefined,
                updatedWithinDays: undefined,
                status: undefined,
              })
            }
          >
            <X /> Clear filters
          </Button>
        )}
      </div>
    </div>
  );
}
