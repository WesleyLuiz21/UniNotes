import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { CalendarDays, FilePlus2, FileUp, Library, Plus } from 'lucide-react';
import { useSession } from '@/api/auth';
import { useDashboard } from '@/api/misc';
import { Page } from '@/components/layout/Page';
import { ModuleDot } from '@/components/modules/ModuleBadge';
import { ModuleFormDialog } from '@/components/modules/ModuleFormDialog';
import { ImportDialog } from '@/components/notes/ImportDialog';
import { NoteCard } from '@/components/notes/NoteCard';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, EmptyState, Skeleton } from '@/components/ui/misc';
import { usePageMeta } from '@/hooks/usePageMeta';
import { format } from 'date-fns';

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

export function DashboardPage() {
  usePageMeta('Home');
  const { data: session } = useSession();
  const { data, isLoading } = useDashboard();
  const navigate = useNavigate();
  const [importOpen, setImportOpen] = useState(false);
  const [moduleOpen, setModuleOpen] = useState(false);
  const firstName = session?.user?.displayName.split(' ')[0];

  const actions = [
    { label: 'New note', icon: FilePlus2, onClick: () => navigate('/notes/new'), primary: true },
    { label: 'Open calendar', icon: CalendarDays, onClick: () => navigate('/calendar') },
    { label: 'Browse modules', icon: Library, onClick: () => navigate('/modules') },
    { label: 'Import Markdown', icon: FileUp, onClick: () => setImportOpen(true) },
  ];
  const stats = data?.stats;

  return (
    <Page>
      <section className="mb-8">
        <p className="text-muted-foreground text-sm">{format(new Date(), 'EEEE d MMMM yyyy')}</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-[28px]">
          {greeting()}
          {firstName ? `, ${firstName}` : ''}
        </h1>
      </section>

      <section aria-label="Quick actions" className="mb-8 grid grid-cols-2 gap-3 md:grid-cols-4">
        {actions.map((a) => (
          <button
            key={a.label}
            onClick={a.onClick}
            className={
              a.primary
                ? 'bg-primary text-primary-foreground hover:bg-primary/90 flex items-center gap-3 rounded-xl p-4 text-left shadow-sm transition-colors'
                : 'border-border bg-surface hover:bg-elevated flex items-center gap-3 rounded-xl border p-4 text-left transition-colors'
            }
          >
            <a.icon className="size-5 shrink-0" aria-hidden />
            <span className="text-sm font-medium">{a.label}</span>
          </button>
        ))}
      </section>

      <section aria-label="Activity summary" className="mb-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: 'Total notes', value: stats?.totalNotes },
          { label: 'Modules', value: stats?.totalModules },
          { label: 'Notes this week', value: stats?.notesThisWeek },
          {
            label: 'Recently active module',
            value: stats?.recentlyActiveModule ? (
              <Link
                to={`/modules/${stats.recentlyActiveModule.id}`}
                className="flex min-w-0 items-center gap-2 hover:underline"
              >
                <ModuleDot color={stats.recentlyActiveModule.color} />
                <span className="truncate">{stats.recentlyActiveModule.name}</span>
              </Link>
            ) : (
              '—'
            ),
            small: true,
          },
        ].map((s) => (
          <Card key={s.label} className="p-4">
            <p className="text-muted-foreground text-xs font-medium">{s.label}</p>
            {isLoading ? (
              <Skeleton className="mt-2 h-7 w-16" />
            ) : (
              <div
                className={
                  s.small ? 'mt-2 text-base font-semibold' : 'mt-1 text-2xl font-semibold tabular-nums'
                }
              >
                {s.value ?? 0}
              </div>
            )}
          </Card>
        ))}
      </section>

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <section aria-labelledby="recent-heading">
          <div className="mb-3 flex items-center justify-between">
            <h2 id="recent-heading" className="text-lg font-semibold">
              Recent notes
            </h2>
            <Button variant="link" size="sm" asChild>
              <Link to="/notes">View all</Link>
            </Button>
          </div>
          {isLoading ? (
            <div className="grid gap-3">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-24" />
              ))}
            </div>
          ) : data?.recentNotes.length ? (
            <ul className="grid gap-3">
              {data.recentNotes.map((n) => (
                <li key={n.id}>
                  <NoteCard note={n} />
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              icon={<FilePlus2 />}
              title="No notes yet"
              description="Create your first lecture note or import existing Markdown files."
              action={
                <div className="flex gap-2">
                  <Button onClick={() => navigate('/notes/new')}>
                    <Plus /> New note
                  </Button>
                  <Button variant="outline" onClick={() => setImportOpen(true)}>
                    Import
                  </Button>
                </div>
              }
            />
          )}
        </section>

        <section aria-labelledby="modules-heading">
          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle id="modules-heading">Modules</CardTitle>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => setModuleOpen(true)}
                aria-label="New module"
              >
                <Plus />
              </Button>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <Skeleton className="h-32" />
              ) : data?.modules.length ? (
                <ul className="grid gap-1">
                  {data.modules.map((m) => (
                    <li key={m.id}>
                      <Link
                        to={`/modules/${m.id}`}
                        className="hover:bg-hover flex items-center gap-3 rounded-md px-2 py-2"
                      >
                        <ModuleDot color={m.color} className="size-3" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">{m.name}</span>
                          {m.code && <span className="text-muted-foreground block text-xs">{m.code}</span>}
                        </span>
                        <span className="text-muted-foreground text-xs tabular-nums">
                          {m.noteCount} {m.noteCount === 1 ? 'note' : 'notes'}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="text-muted-foreground py-4 text-center text-sm">
                  <p>No modules yet.</p>
                  <Button variant="link" size="sm" onClick={() => setModuleOpen(true)}>
                    Create a module
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </section>
      </div>

      <ImportDialog open={importOpen} onOpenChange={setImportOpen} />
      <ModuleFormDialog open={moduleOpen} onOpenChange={setModuleOpen} />
    </Page>
  );
}
