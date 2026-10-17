import { useState } from 'react';
import { Link } from 'react-router';
import { Library, Plus } from 'lucide-react';
import { useModules } from '@/api/modules';
import { Page, PageHeader } from '@/components/layout/Page';
import { ModuleFormDialog } from '@/components/modules/ModuleFormDialog';
import { Button } from '@/components/ui/button';
import { EmptyState, Segmented, Skeleton } from '@/components/ui/misc';
import { usePageMeta } from '@/hooks/usePageMeta';
import type { Module } from '@/lib/types';

export function ModuleCard({ m }: { m: Module }) {
  return (
    <Link
      to={`/modules/${m.id}`}
      className="group border-border bg-surface hover:border-input hover:bg-elevated/40 flex h-full flex-col rounded-xl border p-4 transition-colors"
    >
      <div className="mb-3 h-1.5 w-10 rounded-full" style={{ background: m.color }} aria-hidden />
      <h3 className="font-semibold group-hover:underline">{m.name}</h3>
      <p className="text-muted-foreground mt-0.5 text-xs">
        {[m.code, m.academicYear].filter(Boolean).join(' · ') || ' '}
      </p>
      {m.description && <p className="text-muted-foreground mt-2 line-clamp-2 text-sm">{m.description}</p>}
      <p className="text-muted-foreground mt-auto pt-3 text-sm tabular-nums">
        {m.noteCount} {m.noteCount === 1 ? 'note' : 'notes'}
        {m.archivedAt && <span className="bg-elevated ml-2 rounded px-1.5 py-0.5 text-xs">Archived</span>}
      </p>
    </Link>
  );
}

export default function ModulesPage() {
  usePageMeta('Modules');
  const [status, setStatus] = useState<'active' | 'archived'>('active');
  const { data, isLoading } = useModules(status);
  const [open, setOpen] = useState(false);

  // Group by academic year (most recent first).
  const groups = new Map<string, Module[]>();
  for (const m of data ?? []) {
    const key = m.academicYear ?? 'No academic year';
    groups.set(key, [...(groups.get(key) ?? []), m]);
  }

  return (
    <Page>
      <PageHeader
        title="Modules"
        description="Your university subjects, grouped by academic year."
        actions={
          <>
            <Segmented
              label="Module status"
              value={status}
              onChange={setStatus}
              options={[
                { value: 'active', label: 'Active' },
                { value: 'archived', label: 'Archived' },
              ]}
            />
            <Button onClick={() => setOpen(true)}>
              <Plus /> New module
            </Button>
          </>
        }
      />
      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-36" />
          ))}
        </div>
      ) : groups.size === 0 ? (
        <EmptyState
          icon={<Library />}
          title={status === 'active' ? 'No modules yet' : 'No archived modules'}
          description={
            status === 'active'
              ? 'Create a module for each subject you are taking.'
              : 'Archived modules appear here and can be restored at any time.'
          }
          action={
            status === 'active' ? (
              <Button onClick={() => setOpen(true)}>
                <Plus /> New module
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="grid gap-8">
          {[...groups].map(([year, mods]) => (
            <section key={year} aria-labelledby={`year-${year}`}>
              <h2 id={`year-${year}`} className="text-muted-foreground mb-3 text-sm font-semibold">
                {year}
              </h2>
              <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {mods.map((m) => (
                  <li key={m.id}>
                    <ModuleCard m={m} />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
      <ModuleFormDialog open={open} onOpenChange={setOpen} />
    </Page>
  );
}
