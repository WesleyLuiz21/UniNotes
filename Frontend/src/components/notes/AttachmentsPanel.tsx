import { Download, FileText, ImageIcon, Paperclip, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { useAttachments, useDeleteAttachment } from '@/api/notes';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Popover, PopoverContent, PopoverTrigger, Spinner } from '@/components/ui/misc';
import { errorMessage } from '@/lib/api';
import type { Attachment } from '@/lib/types';
import { formatBytes } from '@/lib/utils';

export const attachmentMarkdown = (a: Attachment) =>
  a.kind === 'image'
    ? `![${a.originalName.replace(/[[\]]/g, '')}](${a.url})`
    : `[📎 ${a.originalName.replace(/[[\]]/g, '')}](${a.url}?download=1)`;

export function AttachmentsPanel({
  noteId,
  onInsert,
  onUpload,
  disabled,
}: {
  noteId?: string;
  onInsert: (md: string) => void;
  onUpload: () => void;
  disabled?: boolean;
}) {
  const { data, isLoading } = useAttachments(noteId);
  const del = useDeleteAttachment(noteId ?? '');
  const [toDelete, setToDelete] = useState<Attachment | null>(null);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" aria-label="Attachments" disabled={disabled}>
          <Paperclip />
          <span className="hidden sm:inline">Files</span>
          {data?.length ? <span className="bg-elevated rounded px-1 text-xs">{data.length}</span> : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-sm font-medium">Attachments</p>
          <Button size="sm" variant="outline" onClick={onUpload}>
            <Plus /> Add file
          </Button>
        </div>
        <p className="text-muted-foreground mb-2 text-xs">
          Images (PNG, JPEG, WebP) and PDF lecture materials. You can also paste or drop images into the
          editor.
        </p>
        {isLoading && <Spinner />}
        {!noteId || data?.length === 0 ? (
          <p className="text-muted-foreground py-3 text-center text-sm">No attachments yet.</p>
        ) : null}
        <ul className="grid max-h-72 gap-1 overflow-y-auto">
          {data?.map((a) => (
            <li key={a.id} className="hover:bg-hover flex items-center gap-2 rounded-md px-1.5 py-1">
              {a.kind === 'image' ? (
                <ImageIcon className="text-muted-foreground size-4 shrink-0" aria-hidden />
              ) : (
                <FileText className="text-muted-foreground size-4 shrink-0" aria-hidden />
              )}
              <button
                type="button"
                className="min-w-0 flex-1 text-left"
                onClick={() => onInsert(attachmentMarkdown(a))}
                title="Insert into note"
              >
                <span className="block truncate text-sm">{a.originalName}</span>
                <span className="text-muted-foreground block text-xs">
                  {formatBytes(a.sizeBytes)} · click to insert
                </span>
              </button>
              <a
                href={`${a.url}?download=1`}
                className="text-muted-foreground hover:text-foreground rounded p-1"
                aria-label={`Download ${a.originalName}`}
              >
                <Download className="size-4" />
              </a>
              <button
                type="button"
                className="text-muted-foreground hover:text-danger rounded p-1"
                aria-label={`Delete ${a.originalName}`}
                onClick={() => setToDelete(a)}
              >
                <Trash2 className="size-4" />
              </button>
            </li>
          ))}
        </ul>
        <ConfirmDialog
          open={Boolean(toDelete)}
          onOpenChange={(o) => !o && setToDelete(null)}
          title="Delete attachment?"
          description={`“${toDelete?.originalName}” will be permanently deleted. References to it in your notes will stop working.`}
          confirmLabel="Delete"
          destructive
          pending={del.isPending}
          onConfirm={() =>
            toDelete &&
            del.mutate(toDelete.id, {
              onSuccess: () => {
                toast.success('Attachment deleted');
                setToDelete(null);
              },
              onError: (e) => toast.error(errorMessage(e)),
            })
          }
        />
      </PopoverContent>
    </Popover>
  );
}
