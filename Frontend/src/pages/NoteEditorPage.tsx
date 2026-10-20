import { useCallback, useDeferredValue, useEffect, useRef, useState } from 'react';
import { Link, useBlocker, useNavigate, useParams, useSearchParams } from 'react-router';
import {
  Archive,
  ArchiveRestore,
  Columns2,
  Eye,
  FileDown,
  FileArchive,
  History,
  MoreHorizontal,
  PencilLine,
  Star,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { useSession } from '@/api/auth';
import { useModules } from '@/api/modules';
import {
  createNote,
  exportUrls,
  patchNote,
  uploadAttachment,
  useDeleteNote,
  useNote,
  useNoteAction,
  useUpdateNoteMeta,
} from '@/api/notes';
import { EditorToolbar } from '@/components/editor/EditorToolbar';
import { MarkdownEditor, type MarkdownEditorHandle } from '@/components/editor/MarkdownEditor';
import { MarkdownPreview } from '@/components/markdown/MarkdownPreview';
import { AttachmentsPanel, attachmentMarkdown } from '@/components/notes/AttachmentsPanel';
import { ConflictDialog } from '@/components/notes/ConflictDialog';
import { SaveIndicator } from '@/components/notes/SaveIndicator';
import { TagInput } from '@/components/notes/TagInput';
import { VersionHistoryDialog } from '@/components/notes/VersionHistoryDialog';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input, NativeSelect } from '@/components/ui/input';
import { EmptyState, Segmented, Skeleton } from '@/components/ui/misc';
import { useAutosave } from '@/hooks/useAutosave';
import { useIsDesktop } from '@/hooks/useMediaQuery';
import { usePageMeta } from '@/hooks/usePageMeta';
import { ApiError, errorMessage } from '@/lib/api';
import { formatLectureDate, todayDateOnly } from '@/lib/dates';
import { invalidateNoteLists, qk, queryClient } from '@/lib/queryClient';
import type { Note } from '@/lib/types';
import { cn, modKey } from '@/lib/utils';

type Mode = 'edit' | 'split' | 'preview';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export default function NoteEditorPage() {
  const { noteId = 'new' } = useParams();
  const isNew = noteId === 'new';
  const [params] = useSearchParams();
  const { data: session } = useSession();
  const { data: note, isLoading, error } = useNote(isNew ? undefined : noteId);

  // Keep the same editor instance when a brand-new note receives its id after the first save.
  const createdId = useRef<string | null>(null);
  const [editorKey, setEditorKey] = useState(noteId);
  useEffect(() => {
    if (noteId !== createdId.current) setEditorKey(noteId);
  }, [noteId]);

  if (!isNew && editorKey === noteId) {
    if (isLoading) return <EditorSkeleton />;
    if (error || !note) {
      return (
        <div className="p-6">
          <EmptyState
            title={
              error instanceof ApiError && error.status === 404 ? 'Note not found' : 'Could not load the note'
            }
            description={
              error instanceof ApiError && error.status === 404
                ? 'It may have been deleted. Check the recycle bin in Archive.'
                : errorMessage(error)
            }
            action={
              <Button asChild variant="outline">
                <Link to="/notes">Back to notes</Link>
              </Button>
            }
          />
        </div>
      );
    }
  }

  const dateParam = params.get('date');
  const defaults = {
    moduleId: params.get('moduleId') ?? session?.user?.preferences.lastModuleId ?? null,
    lectureDate: dateParam && DATE_RE.test(dateParam) ? dateParam : todayDateOnly(),
  };
  return (
    <NoteEditor
      key={editorKey}
      initial={isNew ? null : (note ?? null)}
      defaults={defaults}
      onCreated={(id) => {
        createdId.current = id;
      }}
    />
  );
}

function EditorSkeleton() {
  return (
    <div className="grid gap-4 p-6" aria-busy="true" aria-label="Loading note">
      <Skeleton className="h-9 w-2/3" />
      <Skeleton className="h-6 w-1/2" />
      <Skeleton className="h-96" />
    </div>
  );
}

interface Meta {
  moduleId: string | null;
  lectureDate: string | null;
  tags: string[];
  isFavourite: boolean;
}

function NoteEditor({
  initial,
  defaults,
  onCreated,
}: {
  initial: Note | null;
  defaults: { moduleId: string | null; lectureDate: string };
  onCreated: (id: string) => void;
}) {
  const navigate = useNavigate();
  const isDesktop = useIsDesktop();
  const { data: session } = useSession();
  const { data: modules } = useModules('all');
  const prefs = session?.user?.preferences;
  const editor = useRef<MarkdownEditorHandle>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const allowNavigation = useRef<string | null>(null);

  const [title, setTitle] = useState(initial?.title ?? '');
  const [content, setContent] = useState(initial?.markdownContent ?? '');
  const [meta, setMeta] = useState<Meta>({
    moduleId: initial ? initial.moduleId : defaults.moduleId,
    // An existing undated note stays undated; only new notes get the default date.
    lectureDate: initial ? initial.lectureDate : defaults.lectureDate,
    tags: initial?.tags ?? [],
    isFavourite: initial?.isFavourite ?? false,
  });
  const [archivedAt, setArchivedAt] = useState(initial?.archivedAt ?? null);
  const [mode, setMode] = useState<Mode>(initial ? 'preview' : 'edit');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const deferredContent = useDeferredValue(content);
  const effectiveMode: Mode = mode === 'split' && !isDesktop ? 'edit' : mode;

  const updateMeta = useUpdateNoteMeta();
  const noteAction = useNoteAction();
  const deleteNote = useDeleteNote();

  const autosave = useAutosave(initial, {
    create: (draft) => createNote({ ...draft, ...meta }),
    update: (id, draft, revision) => patchNote(id, { ...draft, revision }),
    onSaved: (note, created) => {
      queryClient.setQueryData(qk.note(note.id), note);
      invalidateNoteLists();
      if (created) {
        onCreated(note.id);
        allowNavigation.current = `/notes/${note.id}`;
        navigate(`/notes/${note.id}`, { replace: true });
      }
    },
  });
  const { status, flush, setDraft } = autosave;
  const noteId = autosave.noteId;

  usePageMeta(title.trim() || (noteId ? 'Untitled note' : 'New note'), [{ label: 'Notes', to: '/notes' }]);

  // ----- Leaving with unsaved changes -----
  const blocker = useBlocker(({ currentLocation, nextLocation }) => {
    if (nextLocation.pathname === allowNavigation.current) return false;
    return autosave.dirty && currentLocation.pathname !== nextLocation.pathname;
  });
  const [leaveDialog, setLeaveDialog] = useState(false);
  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    // Try to save first; only ask if saving is impossible (offline, conflict, invalid).
    void flush().then((ok) => {
      if (ok) blocker.proceed();
      else setLeaveDialog(true);
    });
  }, [blocker, flush]);
  useEffect(() => {
    if (!autosave.dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [autosave.dirty]);

  // ----- Metadata (saved immediately for existing notes; included on create for new ones) -----
  const changeMeta = (patch: Partial<Meta>) => {
    setMeta((m) => ({ ...m, ...patch }));
    if (noteId) {
      updateMeta.mutate(
        { id: noteId, ...patch },
        { onError: (e) => toast.error(`Could not update note: ${errorMessage(e)}`) },
      );
    }
  };

  // ----- Uploads -----
  const { getNoteId } = autosave;
  const ensureNote = useCallback(async () => {
    if (getNoteId()) return getNoteId();
    await flush(true);
    return getNoteId();
  }, [getNoteId, flush]);

  const uploadFiles = useCallback(
    async (files: File[], placeholder: (text: string) => (replacement: string) => void) => {
      const id = await ensureNote();
      if (!id) {
        toast.error('Save the note before adding files.');
        return;
      }
      for (const file of files) {
        const replace = placeholder(`![Uploading ${file.name || 'image'}…]()\n`);
        try {
          const att = await uploadAttachment(id, file);
          replace(`${attachmentMarkdown(att)}\n`);
        } catch (e) {
          replace('');
          toast.error(`Upload failed: ${errorMessage(e)}`);
        }
      }
    },
    [ensureNote],
  );

  const onPickFiles = (list: FileList | null) => {
    const files = Array.from(list ?? []);
    if (!files.length || !editor.current) return;
    if (effectiveMode === 'preview') setMode('edit');
    const handle = editor.current;
    void uploadFiles(files, (text) => handle.placeholderAtCursor(text));
  };

  const saveNow = async () => {
    const ok = await flush();
    if (ok) toast.success('Saved', { duration: 1200 });
  };

  // ----- Conflict resolution -----
  const adoptServerVersion = () => {
    if (!autosave.conflict) return;
    const server = autosave.conflict;
    autosave.adoptServer(server);
    setTitle(server.title);
    setContent(server.markdownContent);
    editor.current?.setValue(server.markdownContent);
    toast.info('Loaded the saved version');
  };
  const saveMineAsNew = async () => {
    const draft = autosave.getDraft();
    try {
      const copy = await createNote({
        ...draft,
        title: `${draft.title || 'Untitled note'} (my version)`,
        ...meta,
      });
      invalidateNoteLists();
      adoptServerVersion();
      toast.success('Your version was saved as a new note', {
        action: { label: 'Open', onClick: () => navigate(`/notes/${copy.id}`) },
      });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const onRestored = (note: Note) => {
    autosave.adoptServer(note);
    setTitle(note.title);
    setContent(note.markdownContent);
    editor.current?.setValue(note.markdownContent);
  };

  const moduleOptions = modules?.filter((m) => !m.archivedAt || m.id === meta.moduleId) ?? [];

  return (
    <div className="flex h-[calc(100dvh-3.5rem)] min-h-0 flex-col">
      {/* Header */}
      <div className="border-border bg-background border-b px-4 pt-4 pb-3 sm:px-6">
        {archivedAt && (
          <div className="bg-elevated mb-3 flex items-center justify-between gap-2 rounded-md px-3 py-2 text-sm">
            <span>This note is archived.</span>
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                noteId &&
                noteAction.mutate(
                  { id: noteId, action: 'unarchive' },
                  { onSuccess: () => setArchivedAt(null) },
                )
              }
            >
              <ArchiveRestore /> Unarchive
            </Button>
          </div>
        )}
        <div className="flex items-start gap-2">
          <label htmlFor="note-title" className="sr-only">
            Title
          </label>
          <input
            id="note-title"
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              setDraft({ title: e.target.value });
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                if (effectiveMode === 'preview') setMode('edit');
                setTimeout(() => editor.current?.focus());
              }
            }}
            placeholder="Untitled note"
            maxLength={300}
            autoFocus={!initial}
            className="placeholder:text-muted-foreground/70 min-w-0 flex-1 rounded-md bg-transparent px-1 text-xl font-semibold tracking-tight outline-none sm:text-2xl"
          />
          <button
            type="button"
            onClick={() => changeMeta({ isFavourite: !meta.isFavourite })}
            className={cn(
              'text-muted-foreground hover:bg-hover hover:text-warning grid size-9 shrink-0 place-items-center rounded-md',
              meta.isFavourite && 'text-warning',
            )}
            aria-label={meta.isFavourite ? 'Remove from favourites' : 'Add to favourites'}
            aria-pressed={meta.isFavourite}
          >
            <Star className={cn('size-5', meta.isFavourite && 'fill-current')} />
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Note actions">
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem disabled={!noteId} onSelect={() => setHistoryOpen(true)}>
                <History /> Version history
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem disabled={!noteId} asChild>
                <a href={noteId ? exportUrls.noteMarkdown(noteId) : undefined} onClick={() => void flush()}>
                  <FileDown /> Export Markdown (.md)
                </a>
              </DropdownMenuItem>
              <DropdownMenuItem disabled={!noteId} asChild>
                <a href={noteId ? exportUrls.noteZip(noteId) : undefined} onClick={() => void flush()}>
                  <FileArchive /> Export with images (.zip)
                </a>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {archivedAt ? (
                <DropdownMenuItem
                  disabled={!noteId}
                  onSelect={() =>
                    noteId &&
                    noteAction.mutate(
                      { id: noteId, action: 'unarchive' },
                      { onSuccess: () => setArchivedAt(null) },
                    )
                  }
                >
                  <ArchiveRestore /> Unarchive
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem
                  disabled={!noteId}
                  onSelect={() =>
                    noteId &&
                    noteAction.mutate(
                      { id: noteId, action: 'archive' },
                      { onSuccess: (n) => (setArchivedAt(n.archivedAt), toast.success('Note archived')) },
                    )
                  }
                >
                  <Archive /> Archive
                </DropdownMenuItem>
              )}
              <DropdownMenuItem destructive disabled={!noteId} onSelect={() => setConfirmDelete(true)}>
                <Trash2 /> Move to recycle bin
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Metadata row */}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor="note-module">
            Module
          </label>
          <NativeSelect
            id="note-module"
            className="h-8 w-auto max-w-[14rem] text-[13px]"
            value={meta.moduleId ?? ''}
            onChange={(e) => changeMeta({ moduleId: e.target.value || null })}
          >
            <option value="">No module</option>
            {moduleOptions.map((m) => (
              <option key={m.id} value={m.id}>
                {m.code ? `${m.code} · ` : ''}
                {m.name}
              </option>
            ))}
          </NativeSelect>
          <label className="sr-only" htmlFor="note-date">
            Lecture date
          </label>
          <Input
            id="note-date"
            type="date"
            className="h-8 w-auto text-[13px]"
            value={meta.lectureDate ?? ''}
            title={
              meta.lectureDate
                ? `Lecture date: ${formatLectureDate(meta.lectureDate, 'long')}`
                : 'Undated — choose a lecture date'
            }
            onChange={(e) => {
              // Clearing the field makes the note undated.
              if (e.target.value === '') changeMeta({ lectureDate: null });
              else if (DATE_RE.test(e.target.value)) changeMeta({ lectureDate: e.target.value });
            }}
          />
          <TagInput
            id="note-tags"
            value={meta.tags}
            onChange={(tags) => changeMeta({ tags })}
            className="min-h-8 min-w-[12rem] flex-1 py-0.5"
          />
        </div>

        {/* Mode + status row */}
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <Segmented
            label="Editor mode"
            value={effectiveMode}
            onChange={setMode}
            options={[
              { value: 'edit', label: 'Edit', icon: <PencilLine /> },
              ...(isDesktop ? [{ value: 'split' as const, label: 'Split', icon: <Columns2 /> }] : []),
              { value: 'preview', label: 'Preview', icon: <Eye /> },
            ]}
          />
          <div className="flex items-center gap-1">
            <SaveIndicator
              status={status}
              lastSavedAt={autosave.lastSavedAt}
              error={autosave.error}
              onRetry={() => void flush()}
            />
            <AttachmentsPanel
              noteId={noteId ?? undefined}
              onInsert={(md) => (
                effectiveMode === 'preview' && setMode('edit'),
                editor.current?.insert(`${md}\n`)
              )}
              onUpload={() => fileInput.current?.click()}
            />
          </div>
        </div>
      </div>

      <input
        ref={fileInput}
        type="file"
        multiple
        accept="image/png,image/jpeg,image/webp,application/pdf,.c,.h,.py,.js,.ts,.html"
        className="sr-only"
        aria-label="Upload image or PDF"
        tabIndex={-1}
        onChange={(e) => (onPickFiles(e.target.files), (e.target.value = ''))}
      />

      {/* Body */}
      <div className="flex min-h-0 flex-1">
        <section
          className={cn(
            'flex min-h-0 min-w-0 flex-1 flex-col',
            effectiveMode === 'preview' && 'hidden',
            effectiveMode === 'split' && 'border-border border-r',
          )}
          aria-label="Editor"
        >
          <EditorToolbar
            onCommand={(cmd) => editor.current?.run(cmd)}
            onInsertImage={() => fileInput.current?.click()}
          />
          <div className="bg-surface min-h-0 flex-1">
            <MarkdownEditor
              ref={editor}
              initialValue={initial?.markdownContent ?? ''}
              onChange={(v) => {
                setContent(v);
                setDraft({ markdownContent: v });
              }}
              onSave={() => void saveNow()}
              onFiles={(files, placeholder) => void uploadFiles(files, placeholder)}
              fontSize={prefs?.editorFontSize}
              lineWrap={prefs?.editorLineWrap ?? true}
              placeholder={`Start typing your notes in Markdown…  (${modKey}+S saves immediately; paste images directly)`}
            />
          </div>
        </section>
        {effectiveMode !== 'edit' && (
          <section
            className="bg-background min-h-0 min-w-0 flex-1 overflow-y-auto"
            aria-label="Preview"
            data-testid="note-preview"
          >
            <div className="mx-auto max-w-3xl px-5 py-6 sm:px-8">
              {deferredContent.trim() ? (
                <MarkdownPreview markdown={deferredContent} />
              ) : (
                <p className="text-muted-foreground">
                  Nothing to preview yet.{' '}
                  <button className="text-accent underline" onClick={() => setMode('edit')}>
                    Start writing
                  </button>
                </p>
              )}
            </div>
          </section>
        )}
      </div>

      {noteId && (
        <VersionHistoryDialog
          open={historyOpen}
          onOpenChange={setHistoryOpen}
          noteId={noteId}
          beforeRestore={() => flush()}
          onRestored={onRestored}
        />
      )}
      <ConflictDialog
        server={autosave.conflict}
        mine={autosave.getDraft()}
        onKeepMine={autosave.resolveKeepMine}
        onUseServer={adoptServerVersion}
        onSaveAsNew={() => void saveMineAsNew()}
      />
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Move note to the recycle bin?"
        description="You can restore it from Archive → Recycle bin."
        confirmLabel="Move to recycle bin"
        destructive
        pending={deleteNote.isPending}
        onConfirm={async () => {
          if (!noteId) return;
          await flush();
          deleteNote.mutate(noteId, {
            onSuccess: () => {
              allowNavigation.current = '/notes';
              toast.success('Note moved to the recycle bin', {
                action: {
                  label: 'Undo',
                  onClick: () => noteAction.mutate({ id: noteId, action: 'restore' }),
                },
              });
              navigate('/notes');
            },
            onError: (e) => toast.error(errorMessage(e)),
          });
        }}
      />
      <ConfirmDialog
        open={leaveDialog}
        onOpenChange={(o) => {
          setLeaveDialog(o);
          if (!o && blocker.state === 'blocked') blocker.reset();
        }}
        title="Leave without saving?"
        description={
          status === 'conflict'
            ? 'This note has an unresolved conflict. If you leave now, your unsaved changes will be lost.'
            : 'Your latest changes could not be saved. If you leave now, they will be lost.'
        }
        confirmLabel="Leave anyway"
        destructive
        onConfirm={() => {
          setLeaveDialog(false);
          if (blocker.state === 'blocked') blocker.proceed();
        }}
      />
    </div>
  );
}
