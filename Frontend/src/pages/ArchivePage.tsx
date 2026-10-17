import { lazy, Suspense, useState } from 'react';
import { useSearchParams } from 'react-router';
import { Archive, ArchiveRestore, Eye, RotateCcw, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useArchiveModule, useModules } from '@/api/modules';
import { useNote, useNoteAction, useNotes, usePermanentDelete } from '@/api/notes';
import { Page, PageHeader } from '@/components/layout/Page';
import { NoteList } from '@/components/notes/NoteList';
import { Button } from '@/components/ui/button';
import {
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  EmptyState,
  Skeleton,
  Spinner,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/misc';
import { usePageMeta } from '@/hooks/usePageMeta';
import { errorMessage } from '@/lib/api';
import { formatRelative } from '@/lib/dates';
import { ModuleCard } from './ModulesPage';

const MarkdownPreview = lazy(() => import('@/components/markdown/MarkdownPreview'));

export default function ArchivePage() {
  usePageMeta('Archive');
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') ?? 'notes';
  return (
    <Page>
      <PageHeader
        title="Archive"
        description="Archived notes and modules stay searchable with filters. Deleted notes wait in the recycle bin until you remove them permanently."
      />
      <Tabs value={tab} onValueChange={(v) => setParams({ tab: v }, { replace: true })}>
        <TabsList className="mb-4">
          <TabsTrigger value="notes">Archived notes</TabsTrigger>
          <TabsTrigger value="modules">Archived modules</TabsTrigger>
          <TabsTrigger value="bin">
            <Trash2 /> Recycle bin
          </TabsTrigger>
        </TabsList>
        <TabsContent value="notes">
          <ArchivedNotes />
        </TabsContent>
        <TabsContent value="modules">
          <ArchivedModules />
        </TabsContent>
        <TabsContent value="bin">
          <RecycleBin />
        </TabsContent>
      </Tabs>
    </Page>
  );
}

function ArchivedNotes() {
  const [page, setPage] = useState(1);
  const { data, isLoading } = useNotes({ status: 'archived', page, pageSize: 20 });
  const action = useNoteAction();
  return (
    <NoteList
      data={data}
      isLoading={isLoading}
      onPage={setPage}
      empty={
        <EmptyState
          icon={<Archive />}
          title="No archived notes"
          description="Archive notes you no longer need day-to-day; they remain available here."
        />
      }
      renderActions={(n) => (
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            action.mutate(
              { id: n.id, action: 'unarchive' },
              {
                onSuccess: () => toast.success('Note unarchived'),
                onError: (e) => toast.error(errorMessage(e)),
              },
            )
          }
        >
          <ArchiveRestore /> Unarchive
        </Button>
      )}
    />
  );
}

function ArchivedModules() {
  const { data, isLoading } = useModules('archived');
  const archive = useArchiveModule();
  if (isLoading) return <Skeleton className="h-36" />;
  if (!data?.length) return <EmptyState icon={<Archive />} title="No archived modules" />;
  return (
    <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {data.map((m) => (
        <li key={m.id} className="relative">
          <ModuleCard m={m} />
          <Button
            variant="outline"
            size="sm"
            className="absolute top-3 right-3"
            onClick={() =>
              archive.mutate(
                { id: m.id, archived: false },
                { onSuccess: () => toast.success('Module restored') },
              )
            }
          >
            <ArchiveRestore /> Restore
          </Button>
        </li>
      ))}
    </ul>
  );
}

function RecycleBin() {
  const [page, setPage] = useState(1);
  const { data, isLoading } = useNotes({ status: 'deleted', page, pageSize: 20, sort: 'updated' });
  const action = useNoteAction();
  const purge = usePermanentDelete();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState<'selected' | 'all' | null>(null);
  const [params, setParams] = useSearchParams();
  const preview = params.get('preview');
  const setPreview = (id: string | null) =>
    setParams((p) => {
      if (id) p.set('preview', id);
      else p.delete('preview');
      return p;
    });

  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const doPurge = () =>
    purge.mutate(confirm === 'all' ? { all: true } : { ids: [...selected] }, {
      onSuccess: (r) => {
        toast.success(`${r.deleted} note(s) permanently deleted`);
        setSelected(new Set());
        setConfirm(null);
      },
      onError: (e) => toast.error(errorMessage(e)),
    });

  return (
    <div>
      {data && data.total > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <p className="text-muted-foreground mr-auto text-sm">
            Notes in the recycle bin can be restored until you delete them permanently.
          </p>
          <Button
            variant="destructive"
            size="sm"
            disabled={selected.size === 0}
            onClick={() => setConfirm('selected')}
          >
            <Trash2 /> Delete selected ({selected.size})
          </Button>
          <Button variant="outline" size="sm" onClick={() => setConfirm('all')}>
            Empty recycle bin
          </Button>
        </div>
      )}
      <NoteList
        data={data}
        isLoading={isLoading}
        onPage={setPage}
        hrefFor={(n) => `/archive?tab=bin&preview=${n.id}`}
        empty={<EmptyState icon={<Trash2 />} title="The recycle bin is empty" />}
        renderActions={(n) => (
          <div className="flex items-center gap-1">
            <label className="hover:bg-hover flex size-8 items-center justify-center rounded-md">
              <input
                type="checkbox"
                className="size-4 accent-[var(--accent)]"
                checked={selected.has(n.id)}
                onChange={() => toggle(n.id)}
                aria-label={`Select “${n.title}”`}
              />
            </label>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Preview “${n.title}”`}
              onClick={() => setPreview(n.id)}
            >
              <Eye />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                action.mutate(
                  { id: n.id, action: 'restore' },
                  {
                    onSuccess: () => toast.success('Note restored'),
                    onError: (e) => toast.error(errorMessage(e)),
                  },
                )
              }
            >
              <RotateCcw /> Restore
            </Button>
          </div>
        )}
      />
      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={confirm === 'all' ? 'Empty the recycle bin?' : `Permanently delete ${selected.size} note(s)?`}
        description="This cannot be undone. Version history and attachments that are not used by other notes are deleted too."
        confirmLabel="Delete permanently"
        destructive
        pending={purge.isPending}
        onConfirm={doPurge}
      />
      <DeletedNotePreview id={preview} onClose={() => setPreview(null)} />
    </div>
  );
}

function DeletedNotePreview({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { data, isLoading } = useNote(id ?? undefined, { includeDeleted: true });
  return (
    <Dialog open={Boolean(id)} onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>{data?.title ?? 'Deleted note'}</DialogTitle>
          <DialogDescription>
            {data?.deletedAt ? `Deleted ${formatRelative(data.deletedAt)}` : ''}
          </DialogDescription>
        </DialogHeader>
        <div className="border-border max-h-[60vh] overflow-y-auto rounded-md border p-4">
          {isLoading ? (
            <Spinner />
          ) : (
            <Suspense fallback={<Spinner />}>
              <MarkdownPreview markdown={data?.markdownContent ?? ''} />
            </Suspense>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
