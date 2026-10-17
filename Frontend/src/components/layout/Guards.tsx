import { useEffect, type ReactNode } from 'react';
import { Navigate, useLocation, useSearchParams } from 'react-router';
import { resetClientState, useSession } from '@/api/auth';
import { onUnauthorized } from '@/lib/api';
import { useTheme } from '@/lib/theme';
import { FullPageSpinner } from './PageStates';

/**
 * Client-side guards are a UX convenience only: every API endpoint enforces authentication and
 * ownership on the server.
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { data, isPending, isError, refetch } = useSession();
  const location = useLocation();
  const { setPreference, preference } = useTheme();

  // Expired/revoked session detected by any API call → drop cached data and go to login.
  useEffect(() => onUnauthorized(() => resetClientState()), []);

  // Adopt the account's theme preference.
  const serverTheme = data?.user?.preferences.theme;
  useEffect(() => {
    if (serverTheme && serverTheme !== preference) setPreference(serverTheme);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverTheme]);

  if (isPending) return <FullPageSpinner />;
  if (isError) {
    return (
      <div className="grid min-h-dvh place-items-center p-6 text-center">
        <div className="grid gap-3">
          <p className="font-medium">Cannot reach UniNotes.</p>
          <button className="text-accent underline" onClick={() => void refetch()}>
            Try again
          </button>
        </div>
      </div>
    );
  }
  if (data.status !== 'authenticated') {
    const next = location.pathname + location.search;
    return (
      <Navigate to={`/login${next && next !== '/' ? `?next=${encodeURIComponent(next)}` : ''}`} replace />
    );
  }
  return <>{children}</>;
}

export function PublicOnly({ children }: { children: ReactNode }) {
  const { data, isPending } = useSession();
  const [params] = useSearchParams();
  if (isPending) return <FullPageSpinner />;
  if (data?.status === 'authenticated') return <Navigate to={safeNext(params.get('next'))} replace />;
  return <>{children}</>;
}

export function RootRedirect() {
  const { data, isPending } = useSession();
  if (isPending) return <FullPageSpinner />;
  return <Navigate to={data?.status === 'authenticated' ? '/dashboard' : '/login'} replace />;
}

/** Only allow same-app relative redirect targets (prevents open redirects via ?next=). */
export function safeNext(next: string | null) {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return '/dashboard';
  return next;
}
