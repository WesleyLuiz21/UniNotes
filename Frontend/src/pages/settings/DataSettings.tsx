import { useState } from 'react';
import { Link } from 'react-router';
import { Download, FileUp, Trash2 } from 'lucide-react';
import { exportUrls } from '@/api/notes';
import { useDataStats } from '@/api/settings';
import { ImportDialog } from '@/components/notes/ImportDialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, Skeleton } from '@/components/ui/misc';
import { usePageMeta } from '@/hooks/usePageMeta';
import { formatBytes } from '@/lib/utils';

export default function DataSettings() {
  usePageMeta('Data', [{ label: 'Settings', to: '/settings' }]);
  const { data, isLoading } = useDataStats();
  const [importOpen, setImportOpen] = useState(false);
  const [withVersions, setWithVersions] = useState(true);

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Your data</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading || !data ? (
            <Skeleton className="h-16" />
          ) : (
            <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
              {[
                ['Active notes', data.notes.active],
                ['Archived notes', data.notes.archived],
                ['In recycle bin', data.notes.deleted],
                ['Saved versions', data.versions],
                ['Attachments', data.attachments.count],
                ['Attachment storage', formatBytes(data.attachments.bytes)],
              ].map(([k, v]) => (
                <div key={k}>
                  <dt className="text-muted-foreground">{k}</dt>
                  <dd className="text-lg font-semibold tabular-nums">{v}</dd>
                </div>
              ))}
            </dl>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Export everything</CardTitle>
          <CardDescription>
            A ZIP with every note as Markdown (with front matter), all images and files, and a manifest.json
            describing modules, tags and attachments — enough to migrate or restore elsewhere. No UniNotes
            account is needed to read it.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-4">
          <Button asChild>
            <a href={exportUrls.all(withVersions)}>
              <Download /> Download full export
            </a>
          </Button>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4 accent-[var(--accent)]"
              checked={withVersions}
              onChange={(e) => setWithVersions(e.target.checked)}
            />
            Include version history
          </label>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Import</CardTitle>
          <CardDescription>
            Import Markdown (.md) files as new notes. Duplicates are detected and never overwrite existing
            notes.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" onClick={() => setImportOpen(true)}>
            <FileUp /> Import Markdown
          </Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Recycle bin</CardTitle>
          <CardDescription>Deleted notes are kept until you permanently delete them.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" asChild>
            <Link to="/archive?tab=bin">
              <Trash2 /> Open recycle bin
            </Link>
          </Button>
        </CardContent>
      </Card>
      <ImportDialog open={importOpen} onOpenChange={setImportOpen} />
    </div>
  );
}
