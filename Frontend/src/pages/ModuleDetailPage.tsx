import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import {
  Archive,
  ArchiveRestore,
  FileArchive,
  FileText,
  FileUp,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { useArchiveModule, useDeleteModule, useModule } from '@/api/modules';
import { exportUrls, useNotes, useSearch } from '@/api/notes';
import { Page, PageHeader } from '@/components/layout/Page';
import { ModuleFormDialog } from '@/components/modules/ModuleFormDialog';
import { ImportDialog } from '@/components/notes/ImportDialog';
import { NoteFilters } from '@/components/notes/NoteFilters';
import { NoteList } from '@/components/notes/NoteList';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input, Label } from '@/components/ui/input';
import { EmptyState, Skeleton } from '@/components/ui/misc';
import { useDebouncedValue } from '@/hooks/useDebounce';
import { usePageMeta } from '@/hooks/usePageMeta';
import { useUrlFilters } from '@/hooks/useUrlFilters';
import { errorMessage } from '@/lib/api';

export default function ModuleDetailPage() {
  const { moduleId = '' } = useParams();
  const navigate = useNavigate();
  const { data: m, isLoading, error } = useModule(moduleId);
  const [filters, setFilters] = useUrlFilters({ sort: 'lecture_desc' });
  const [q, setQ] = useState(filters.q ?? '');
  const debouncedQ = useDebouncedValue(q.trim(), 250);
  const [editOpen, setEditOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [confirmName, setConfirmName] = useState('');
  const archive = useArchiveModule();
  const del = useDeleteModule();
  usePageMeta(m?.name ?? 'Module', [{ label: 'Modules', to: '/modules' }]);

  const base = { ...filters, q: undefined, moduleId, pageSize: 20 };
  const list = useNotes(base, !debouncedQ);
  const search = useSearch(
    { ...base, q: debouncedQ, sort: filters.sort === 'lecture_desc' ? 'relevance' : filters.sort },
    Boolean(debouncedQ),
  );
  const result = debouncedQ ? search : list;

  if (isLoading)
    return (
      <Page>
        <Skeleton className="h-40" />
      </Page>
    );
  if (error || !m) {
    return (
      <Page>
        <EmptyState
          title="Module not found"
          action={
            <Button asChild variant="outline">
              <Link to="/modules">Back to modules</Link>
            </Button>
          }
        />
      </Page>
    );
  }

  return (
    <Page>
      <PageHeader
        title={
          <span className="flex items-center gap-3">
            <span className="size-3.5 shrink-0 rounded-full" style={{ background: m.color }} aria-hidden />
            {m.name}
          </span>
        }
        description={[m.code, m.academicYear, `${m.noteCount} ${m.noteCount === 1 ? 'note' : 'notes'}`]
          .filter(Boolean)
          .join(' · ')}
        actions={
          <>
            <Button onClick={() => navigate(`/notes/new?moduleId=${m.id}`)}>
              <Plus /> New note
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" aria-label="Module actions">
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem onSelect={() => setEditOpen(true)}>
                  <Pencil /> Edit module
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setImportOpen(true)}>
                  <FileUp /> Import Markdown
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <a href={exportUrls.moduleZip(m.id)}>
                    <FileArchive /> Export module (.zip)
                  </a>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onSelect={() =>
                    archive.mutate(
                      { id: m.id, archived: !m.archivedAt },
                      {
                        onSuccess: (r) => toast.success(r.archivedAt ? 'Module archived' : 'Module restored'),
                        onError: (e) => toast.error(errorMessage(e)),
                      },
                    )
                  }
                >
                  {m.archivedAt ? <ArchiveRestore /> : <Archive />}{' '}
                  {m.archivedAt ? 'Restore module' : 'Archive module'}
                </DropdownMenuItem>
                <DropdownMenuItem destructive onSelect={() => (setConfirmName(''), setDeleteOpen(true))}>
                  <Trash2 /> Delete module…
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        }
      >
        {m.description && <p className="mt-3 max-w-2xl text-sm whitespace-pre-line">{m.description}</p>}
        {m.archivedAt && (
          <p className="bg-elevated mt-2 inline-block rounded px-2 py-0.5 text-xs">Archived module</p>
        )}
      </PageHeader>

      <div className="mb-4 grid gap-3">
        <div className="relative">
          <Label htmlFor="module-search" className="sr-only">
            Search this module
          </Label>
          <Search
            className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
            aria-hidden
          />
          <Input
            id="module-search"
            type="search"
            placeholder={`Search notes in ${m.name}…`}
            className="pl-9"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <NoteFilters
          value={filters}
          onChange={setFilters}
          hide={['module', 'year']}
          allowRelevance={Boolean(debouncedQ)}
        />
      </div>

      <NoteList
        data={result.data}
        isLoading={result.isLoading}
        onPage={(page) => setFilters({ page })}
        showModule={false}
        empty={
          <EmptyState
            icon={<FileText />}
            title={debouncedQ ? 'No matching notes' : 'No notes in this module yet'}
            action={
              <Button onClick={() => navigate(`/notes/new?moduleId=${m.id}`)}>
                <Plus /> New note
              </Button>
            }
          />
        }
      />

      <ModuleFormDialog open={editOpen} onOpenChange={setEditOpen} module={m} />
      <ImportDialog open={importOpen} onOpenChange={setImportOpen} defaultModuleId={m.id} />
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={`Delete “${m.name}”?`}
        description="The module will be deleted. Its notes are kept and become unassigned (“No module”). To hide a module without deleting it, archive it instead."
        confirmLabel="Delete module"
        destructive
        pending={del.isPending || confirmName !== m.name}
        onConfirm={() =>
          del.mutate(
            { id: m.id, confirmName },
            {
              onSuccess: (r) => {
                toast.success(`Module deleted. ${r.notesUnassigned} note(s) kept as unassigned.`);
                navigate('/modules');
              },
              onError: (e) => toast.error(errorMessage(e)),
            },
          )
        }
      >
        <div className="grid gap-1.5">
          <Label htmlFor="confirm-name">
            Type <strong>{m.name}</strong> to confirm
          </Label>
          <Input
            id="confirm-name"
            value={confirmName}
            onChange={(e) => setConfirmName(e.target.value)}
            autoComplete="off"
          />
        </div>
      </ConfirmDialog>
    </Page>
  );
}
