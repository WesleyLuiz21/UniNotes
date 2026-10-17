import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { authedSession, mockApi, renderRoutes } from '@/test/utils';
import { AppShell } from './AppShell';
import { RequireAuth } from './Guards';
import { usePageMeta } from '@/hooks/usePageMeta';

function Page({ title }: { title: string }) {
  usePageMeta(title);
  return <h1>{title} page</h1>;
}

describe('AppShell navigation', () => {
  it('navigates with the sidebar and highlights the active route', async () => {
    mockApi((url) => (url.pathname === '/api/auth/session' ? { body: authedSession } : { body: [] }));
    const { router } = renderRoutes(
      [
        {
          element: (
            <RequireAuth>
              <AppShell />
            </RequireAuth>
          ),
          children: [
            { path: '/dashboard', element: <Page title="Home" /> },
            { path: '/modules', element: <Page title="Modules" /> },
          ],
        },
      ],
      ['/dashboard'],
    );
    await screen.findByText('Home page');
    const nav = screen.getByRole('navigation', { name: 'Main' });
    await userEvent.click(nav.querySelector('a[href="/modules"]')!);
    await screen.findByText('Modules page');
    expect(router.state.location.pathname).toBe('/modules');
    expect(nav.querySelector('a[href="/modules"]')).toHaveAttribute('aria-current', 'page');
    expect(document.title).toBe('Modules · UniNotes');
  });

  it('shows an error state when the API is unreachable', async () => {
    mockApi(() => ({ status: 503, body: { error: { code: 'X', message: 'down' } } }));
    renderRoutes(
      [
        {
          path: '/dashboard',
          element: (
            <RequireAuth>
              <p>secret</p>
            </RequireAuth>
          ),
        },
      ],
      ['/dashboard'],
    );
    expect(await screen.findByText('Cannot reach UniNotes.', {}, { timeout: 4000 })).toBeInTheDocument();
    expect(screen.queryByText('secret')).toBeNull();
  });
});
