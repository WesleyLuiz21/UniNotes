import { lazy, Suspense, useEffect, useState } from 'react';
import { History, RotateCcw, Save } from 'lucide-react';
import { toast } from 'sonner';
import { useRestoreVersion, useSaveVersion, useVersion, useVersions } from '@/api/notes';
import { Button } from '@/components/ui/button';
import {
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { EmptyState, Segmented, Spinner } from '@/components/ui/misc';
import { errorMessage } from '@/lib/api';
import { formatDateTime, formatRelative } from '@/lib/dates';
import type { Note } from '@/lib/types';
import { cn } from '@/lib/utils';

const MarkdownPreview = lazy(() => import('@/components/markdown/MarkdownPreview'));

const REASON: Record<string, string> = {
  autosave: 'Automatic snapshot',
  manual: 'Saved manually',
  'pre-restore': 'Before a restore',
  restore: 'Restored version',
  import: 'Imported',
};

export function VersionHistoryDialog({
  open,
  onOpenChange,
  noteId,
  beforeRestore,
  onRestored,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  noteId: string;
  /** Persist pending edits first so a restore never races with autosave. */
  beforeRestore: () => Promise<boolean>;
  onRestored: (note: Note) => void;
}) {
  const { data: versions, isLoading } = useVersions(noteId, open);
  const [selected, setSelected] = useState<string | null>(null);
  const [view, setView] = useState<'preview' | 'source'>('preview');
  const [confirm, setConfirm] = useState(false);
  const { data: version, isFetching } = useVersion(noteId, selected);
  const restore = useRestoreVersion();
  const save = useSaveVersion();

  useEffect(() => {
    if (open && versions?.length && !selected) setSelected(versions[0]!.id);
    if (!open) setSelected(null);
  }, [open, versions, selected]);

  const doRestore = async () => {
    if (!selected) return;
    if (!(await beforeRestore())) {
      toast.error('Save or resolve your current changes before restoring.');
      return;
    }
    restore.mutate(
      { noteId, versionId: selected },
      {
        onSuccess: (note) => {
          toast.success('Version restored. Your previous content was kept in the history.');
          setConfirm(false);
          onOpenChange(false);
          onRestored(note);
        },
        onError: (e) => toast.error(errorMessage(e)),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="xl" className="h-[min(85dvh,760px)] grid-rows-[auto_1fr]">
        <DialogHeader>
          <DialogTitle>Version history</DialogTitle>
          <DialogDescription>
            Snapshots are kept automatically while you edit (at most one every 10 minutes). Restoring creates
            a new revision and never deletes history.
          </DialogDescription>
        </DialogHeader>
        <div className="grid min-h-0 gap-4 md:grid-cols-[260px_1fr]">
          <div className="flex min-h-0 flex-col gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={save.isPending}
              onClick={async () =>
                (await beforeRestore()) &&
                save.mutate(noteId, { onSuccess: () => toast.success('Version saved') })
              }
            >
              <Save /> Save current version
            </Button>
            <ul
              className="border-border min-h-0 flex-1 overflow-y-auto rounded-md border"
              aria-label="Versions"
            >
              {isLoading && (
                <li className="p-4">
                  <Spinner />
                </li>
              )}
              {versions?.length === 0 && (
                <li className="text-muted-foreground p-4 text-sm">
                  No versions yet. They appear as you keep editing.
                </li>
              )}
              {versions?.map((v) => (
                <li key={v.id}>
                  <button
                    type="button"
                    onClick={() => setSelected(v.id)}
                    aria-current={selected === v.id}
                    className={cn(
                      'border-border hover:bg-hover grid w-full gap-0.5 border-b px-3 py-2 text-left text-sm last:border-0',
                      selected === v.id && 'bg-primary/10',
                    )}
                  >
                    <span className="font-medium">{formatRelative(v.createdAt)}</span>
                    <span className="text-muted-foreground text-xs">
                      {REASON[v.reason]} · rev {v.revision} · {v.characters.toLocaleString()} chars
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
          <div className="flex min-h-0 flex-col gap-2">
            {!selected ? (
              <EmptyState icon={<History />} title="Select a version" />
            ) : (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0 text-sm">
                    <p className="truncate font-medium">{version?.title ?? '…'}</p>
                    {version && (
                      <p className="text-muted-foreground text-xs">{formatDateTime(version.createdAt)}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <Segmented
                      label="Version view"
                      value={view}
                      onChange={setView}
                      options={[
                        { value: 'preview', label: 'Preview' },
                        { value: 'source', label: 'Markdown' },
                      ]}
                    />
                    <Button
                      size="sm"
                      onClick={() => setConfirm(true)}
                      disabled={!version || restore.isPending}
                    >
                      <RotateCcw /> Restore
                    </Button>
                  </div>
                </div>
                <div className="border-border min-h-0 flex-1 overflow-y-auto rounded-md border p-4">
                  {isFetching && !version ? (
                    <Spinner />
                  ) : view === 'source' ? (
                    <pre className="font-mono text-xs whitespace-pre-wrap">{version?.markdownContent}</pre>
                  ) : (
                    <Suspense fallback={<Spinner />}>
                      <MarkdownPreview markdown={version?.markdownContent ?? ''} />
                    </Suspense>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
        <ConfirmDialog
          open={confirm}
          onOpenChange={setConfirm}
          title="Restore this version?"
          description="The note’s content will be replaced with this version. The current content is saved to the history first, so you can undo this."
          confirmLabel="Restore version"
          onConfirm={() => void doRestore()}
          pending={restore.isPending}
        />
      </DialogContent>
    </Dialog>
  );
}
