import { Copy, Download, FilePlus2, Save, ServerCog } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { formatDateTime } from '@/lib/dates';
import type { Note } from '@/lib/types';
import type { Draft } from '@/hooks/useAutosave';

function downloadText(filename: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Shown when the server holds a newer revision than the one this editor started from.
 * Nothing is overwritten until the user picks an option, and the local draft can always be
 * copied, downloaded or saved as a separate note.
 */
export function ConflictDialog({
  server,
  mine,
  onKeepMine,
  onUseServer,
  onSaveAsNew,
}: {
  server: Note | null;
  mine: Draft;
  onKeepMine: () => void;
  onUseServer: () => void;
  onSaveAsNew: () => void;
}) {
  return (
    <Dialog open={Boolean(server)}>
      <DialogContent
        size="xl"
        hideClose
        onEscapeKeyDown={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>This note was changed somewhere else</DialogTitle>
          <DialogDescription>
            A newer version was saved {server ? `at ${formatDateTime(server.updatedAt)}` : ''} (for example in
            another tab or device). Your changes have not been saved yet and are kept below. Choose how to
            continue.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 md:grid-cols-2">
          <section className="grid min-w-0 gap-1.5">
            <h3 className="text-sm font-medium">Your version (unsaved)</h3>
            <pre className="border-border bg-code h-64 overflow-auto rounded-md border p-3 font-mono text-xs whitespace-pre-wrap">
              {mine.markdownContent}
            </pre>
          </section>
          <section className="grid min-w-0 gap-1.5">
            <h3 className="text-sm font-medium">Saved version (revision {server?.revision})</h3>
            <pre className="border-border bg-code h-64 overflow-auto rounded-md border p-3 font-mono text-xs whitespace-pre-wrap">
              {server?.markdownContent}
            </pre>
          </section>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              void navigator.clipboard
                ?.writeText(mine.markdownContent)
                .then(() => toast.success('Your version was copied'))
            }
          >
            <Copy /> Copy my version
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => downloadText(`${mine.title || 'note'}-my-version.md`, mine.markdownContent)}
          >
            <Download /> Download my version
          </Button>
        </div>
        <div className="border-border flex flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:justify-end">
          <Button variant="outline" onClick={onSaveAsNew}>
            <FilePlus2 /> Save mine as a new note
          </Button>
          <Button variant="secondary" onClick={onUseServer}>
            <ServerCog /> Discard mine, use saved version
          </Button>
          <Button variant="destructive" onClick={onKeepMine}>
            <Save /> Overwrite with my version
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
