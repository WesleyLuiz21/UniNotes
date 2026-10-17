import { Link } from 'react-router';
import { FileQuestion } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/misc';
import { usePageMeta } from '@/hooks/usePageMeta';
import { Page } from '@/components/layout/Page';

export function NotFoundPage() {
  usePageMeta('Not found');
  return (
    <Page>
      <EmptyState
        icon={<FileQuestion />}
        title="Page not found"
        description="The page you’re looking for doesn’t exist or may have been moved."
        action={
          <Button asChild>
            <Link to="/dashboard">Back to dashboard</Link>
          </Button>
        }
      />
    </Page>
  );
}
