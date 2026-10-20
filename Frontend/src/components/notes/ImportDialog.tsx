import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { FileUp, TriangleAlert } from 'lucide-react';
import { toast } from 'sonner';
import { useSession } from '@/api/auth';
import { useModules } from '@/api/modules';
import { importMarkdown } from '@/api/notes';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, Input, NativeSelect } from '@/components/ui/input';
import { Spinner } from '@/components/ui/misc';
import { ApiError, errorMessage } from '@/lib/api';
import { todayDateOnly } from '@/lib/dates';
import { formatBytes } from '@/lib/utils';

const MarkdownPreview = lazy(() => import('@/components/markdown/MarkdownPreview'));
const MAX_BYTES = 2 * 1024 * 1024;

export function ImportDialog({
  open,
  onOpenChange,
  defaultModuleId,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  defaultModuleId?: string;
}) {
  const { data: session } = useSession();
  const { data: modules } = useModules('active');
  const navigate = useNavigate();
  const fileInput = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [moduleId, setModuleId] = useState('');
  const [lectureDate, setLectureDate] = useState(todayDateOnly());
  const [title, setTitle] = useState('');
  const [duplicate, setDuplicate] = useState<{ id: string; title: string } | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (open) {
      setFile(null);
      setText('');
      setError(null);
      setDuplicate(null);
      setTitle('');
      setLectureDate(todayDateOnly());
      setModuleId(defaultModuleId ?? session?.user?.preferences.lastModuleId ?? '');
    }
  }, [open, defaultModuleId, session?.user?.preferences.lastModuleId]);

  const pick = async (f: File | undefined) => {
    setError(null);
    setDuplicate(null);
    if (!f) return;
    if (!/\.(md|markdown)$/i.test(f.name)) return setError('Choose a Markdown file (.md or .markdown).');
    if (f.size > MAX_BYTES)
      return setError(`File is too large (${formatBytes(f.size)}). The limit is ${formatBytes(MAX_BYTES)}.`);
    const content = await f.text();
    setFile(f);
    setText(content);
    const h1 = /^#\s+(.+)$/m.exec(content)?.[1]?.trim();
    setTitle(h1 ?? f.name.replace(/\.(md|markdown)$/i, '').replace(/[_-]+/g, ' '));
  };

  const submit = async (allowDuplicate = false) => {
    if (!file) return;
    setPending(true);
    try {
      const note = await importMarkdown({
        file,
        moduleId: moduleId || null,
        lectureDate,
        title,
        allowDuplicate,
      });
      toast.success(`Imported “${note.title}”`);
      onOpenChange(false);
      navigate(`/notes/${note.id}`);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'DUPLICATE_IMPORT') {
        setDuplicate((e.details as { existing: { id: string; title: string } }).existing);
      } else setError(errorMessage(e));
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Import Markdown</DialogTitle>
          <DialogDescription>
            The file is imported as a new note. Existing notes are never overwritten.
          </DialogDescription>
        </DialogHeader>

        <input
          ref={fileInput}
          type="file"
          accept=".md,.markdown,text/markdown"
          className="sr-only"
          aria-label="Markdown file"
          onChange={(e) => void pick(e.target.files?.[0])}
        />
        {!file ? (
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              void pick(e.dataTransfer.files[0]);
            }}
            className="border-border text-muted-foreground hover:border-input hover:bg-hover flex flex-col items-center gap-2 rounded-lg border-2 border-dashed px-6 py-10 text-sm"
          >
            <FileUp className="size-6" aria-hidden />
            <span>
              <span className="text-foreground font-medium">Choose a .md file</span> or drop it here
            </span>
            <span className="text-xs">Up to {formatBytes(MAX_BYTES)}</span>
          </button>
        ) : (
          <div className="grid gap-4">
            <div className="bg-elevated flex items-center justify-between gap-2 rounded-md px-3 py-2 text-sm">
              <span className="truncate">
                {file.name} · {formatBytes(file.size)}
              </span>
              <Button variant="link" size="sm" onClick={() => fileInput.current?.click()}>
                Change
              </Button>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Title" htmlFor="imp-title" className="sm:col-span-3">
                <Input
                  id="imp-title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  maxLength={300}
                />
              </Field>
              <Field label="Module" htmlFor="imp-module" className="sm:col-span-2">
                <NativeSelect id="imp-module" value={moduleId} onChange={(e) => setModuleId(e.target.value)}>
                  <option value="">No module</option>
                  {modules?.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.code ? `${m.code} · ` : ''}
                      {m.name}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field label="Lecture date (optional)" htmlFor="imp-date">
                <Input
                  id="imp-date"
                  type="date"
                  value={lectureDate}
                  onChange={(e) => setLectureDate(e.target.value)}
                />
              </Field>
            </div>
            <div>
              <p className="mb-2 text-sm font-medium">Preview</p>
              <div className="border-border max-h-72 overflow-y-auto rounded-md border p-4">
                <Suspense fallback={<Spinner />}>
                  <MarkdownPreview markdown={text} />
                </Suspense>
              </div>
            </div>
          </div>
        )}

        {error && (
          <p role="alert" className="text-danger text-sm">
            {error}
          </p>
        )}
        {duplicate && (
          <div
            role="alert"
            className="border-warning/40 bg-warning/10 flex gap-2 rounded-md border p-3 text-sm"
          >
            <TriangleAlert className="text-warning size-4 shrink-0" aria-hidden />
            <div className="grid gap-2">
              <p>
                This file was already imported as <strong>“{duplicate.title}”</strong>.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => (onOpenChange(false), navigate(`/notes/${duplicate.id}`))}
                >
                  Open existing note
                </Button>
                <Button size="sm" variant="secondary" onClick={() => void submit(true)} disabled={pending}>
                  Import a second copy
                </Button>
              </div>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => void submit(false)} disabled={!file || pending}>
            {pending && <Spinner />} Import note
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
