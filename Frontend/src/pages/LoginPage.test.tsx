import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { PublicOnly, RequireAuth } from '@/components/layout/Guards';
import { authedSession, mockApi, renderRoutes } from '@/test/utils';
import { LoginPage } from './LoginPage';

const routes = [
  {
    path: '/login',
    element: (
      <PublicOnly>
        <LoginPage />
      </PublicOnly>
    ),
  },
  {
    path: '/dashboard',
    element: (
      <RequireAuth>
        <p>Dashboard content</p>
      </RequireAuth>
    ),
  },
  {
    path: '/notes',
    element: (
      <RequireAuth>
        <p>Notes content</p>
      </RequireAuth>
    ),
  },
];

describe('login and route guards', () => {
  it('redirects anonymous users to /login, preserving the target', async () => {
    mockApi((url) =>
      url.pathname === '/api/auth/session'
        ? { body: { status: 'anonymous', user: null, csrfToken: null } }
        : undefined,
    );
    const { router } = renderRoutes(routes, ['/notes']);
    await screen.findByRole('heading', { name: 'Sign in' });
    expect(router.state.location.pathname).toBe('/login');
    expect(router.state.location.search).toBe('?next=%2Fnotes');
  });

  it('validates required fields before submitting', async () => {
    const { calls } = mockApi((url) =>
      url.pathname === '/api/auth/session'
        ? { body: { status: 'anonymous', user: null, csrfToken: null } }
        : undefined,
    );
    renderRoutes(routes, ['/login']);
    await userEvent.click(await screen.findByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Enter your username or email')).toBeInTheDocument();
    expect(screen.getByText('Enter your password')).toBeInTheDocument();
    expect(calls.some((c) => c.url.pathname === '/api/auth/login')).toBe(false);
  });

  it('shows a generic error on bad credentials and clears the password', async () => {
    mockApi((url) => {
      if (url.pathname === '/api/auth/session')
        return { body: { status: 'anonymous', user: null, csrfToken: null } };
      if (url.pathname === '/api/auth/login')
        return {
          status: 401,
          body: { error: { code: 'INVALID_CREDENTIALS', message: 'Incorrect username/email or password' } },
        };
    });
    renderRoutes(routes, ['/login']);
    await userEvent.type(await screen.findByLabelText('Username or email'), 'sam');
    await userEvent.type(screen.getByLabelText('Password', { selector: 'input' }), 'wrong');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Incorrect username/email or password');
    expect(screen.getByLabelText('Password', { selector: 'input' })).toHaveValue('');
  });

  it('toggles password visibility', async () => {
    mockApi((url) =>
      url.pathname === '/api/auth/session'
        ? { body: { status: 'anonymous', user: null, csrfToken: null } }
        : undefined,
    );
    renderRoutes(routes, ['/login']);
    const input = await screen.findByLabelText('Password', { selector: 'input' });
    expect(input).toHaveAttribute('type', 'password');
    await userEvent.click(screen.getByRole('button', { name: 'Show password' }));
    expect(input).toHaveAttribute('type', 'text');
  });

  it('signs in and continues to the requested page', async () => {
    let loggedIn = false;
    mockApi((url) => {
      if (url.pathname === '/api/auth/session')
        return { body: loggedIn ? authedSession : { status: 'anonymous', user: null, csrfToken: null } };
      if (url.pathname === '/api/auth/login') {
        loggedIn = true;
        return { body: authedSession };
      }
    });
    const { router } = renderRoutes(routes, ['/login?next=%2Fnotes']);
    await userEvent.type(await screen.findByLabelText('Username or email'), 'student');
    await userEvent.type(screen.getByLabelText('Password', { selector: 'input' }), 'correct horse');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(router.state.location.pathname).not.toBe('/login'));
    await screen.findByText('Notes content');
    expect(router.state.location.pathname).toBe('/notes');
  });

  it('asks for a second factor when MFA is enabled', async () => {
    mockApi((url) => {
      if (url.pathname === '/api/auth/session')
        return { body: { status: 'anonymous', user: null, csrfToken: null } };
      if (url.pathname === '/api/auth/login')
        return { body: { status: 'mfa_required', user: null, csrfToken: 'c' } };
    });
    renderRoutes(routes, ['/login']);
    await userEvent.type(await screen.findByLabelText('Username or email'), 'student');
    await userEvent.type(screen.getByLabelText('Password', { selector: 'input' }), 'pw');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('heading', { name: 'Two-factor authentication' })).toBeInTheDocument();
    expect(screen.getByLabelText('Authentication code')).toBeInTheDocument();
  });

  it('rejects open-redirect targets', async () => {
    const { safeNext } = await import('@/components/layout/Guards');
    expect(safeNext('https://evil.example')).toBe('/dashboard');
    expect(safeNext('//evil.example')).toBe('/dashboard');
    expect(safeNext('/\\evil.example')).toBe('/dashboard');
    expect(safeNext('/notes/1')).toBe('/notes/1');
    await waitFor(() => undefined);
  });
});
