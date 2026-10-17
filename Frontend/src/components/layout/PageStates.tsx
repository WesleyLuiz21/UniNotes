import { isRouteErrorResponse, Link, useRouteError } from 'react-router';
import { Spinner } from '@/components/ui/misc';
import { Logo } from './Logo';

export function FullPageSpinner() {
  return (
    <div className="grid min-h-dvh place-items-center" role="status" aria-label="Loading">
      <Spinner className="text-muted-foreground size-6" />
    </div>
  );
}

export function PageFallback() {
  return (
    <div className="grid min-h-[40vh] place-items-center" role="status" aria-label="Loading">
      <Spinner className="text-muted-foreground size-5" />
    </div>
  );
}

export function RouteError() {
  const err = useRouteError();
  // A stale deploy can leave old chunk names in an open tab; a reload fetches the new build.
  const chunkError =
    err instanceof Error && /dynamically imported module|Importing a module script failed/i.test(err.message);
  return (
    <div className="grid min-h-dvh place-items-center p-6">
      <div className="grid max-w-md gap-4 text-center">
        <Logo className="justify-center" />
        <h1 className="text-xl font-semibold">
          {isRouteErrorResponse(err) && err.status === 404 ? 'Page not found' : 'Something went wrong'}
        </h1>
        <p className="text-muted-foreground text-sm">
          {chunkError
            ? 'UniNotes was updated. Reload the page to continue.'
            : 'An unexpected error occurred while displaying this page.'}
        </p>
        <div className="flex justify-center gap-3">
          <button className="text-accent underline" onClick={() => window.location.reload()}>
            Reload
          </button>
          <Link className="text-accent underline" to="/dashboard">
            Go to dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
