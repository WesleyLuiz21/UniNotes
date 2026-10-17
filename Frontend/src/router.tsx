import { lazy, Suspense, type ReactNode } from 'react';
import { createBrowserRouter, Navigate, type RouteObject } from 'react-router';
import { AppShell } from '@/components/layout/AppShell';
import { PageFallback, RouteError } from '@/components/layout/PageStates';
import { PublicOnly, RequireAuth, RootRedirect } from '@/components/layout/Guards';
import { LoginPage } from '@/pages/LoginPage';
import { DashboardPage } from '@/pages/DashboardPage';
import { NotFoundPage } from '@/pages/NotFoundPage';

// Heavier pages are code-split (the editor bundle includes CodeMirror and the Markdown renderer).
const NotesPage = lazy(() => import('@/pages/NotesPage'));
const NoteEditorPage = lazy(() => import('@/pages/NoteEditorPage'));
const ModulesPage = lazy(() => import('@/pages/ModulesPage'));
const ModuleDetailPage = lazy(() => import('@/pages/ModuleDetailPage'));
const CalendarPage = lazy(() => import('@/pages/CalendarPage'));
const SearchPage = lazy(() => import('@/pages/SearchPage'));
const ArchivePage = lazy(() => import('@/pages/ArchivePage'));
const SettingsLayout = lazy(() => import('@/pages/settings/SettingsLayout'));
const AccountSettings = lazy(() => import('@/pages/settings/AccountSettings'));
const SecuritySettings = lazy(() => import('@/pages/settings/SecuritySettings'));
const AppearanceSettings = lazy(() => import('@/pages/settings/AppearanceSettings'));
const DataSettings = lazy(() => import('@/pages/settings/DataSettings'));

const s = (node: ReactNode) => <Suspense fallback={<PageFallback />}>{node}</Suspense>;

export const routes: RouteObject[] = [
  { path: '/', element: <RootRedirect />, errorElement: <RouteError /> },
  {
    path: '/login',
    element: (
      <PublicOnly>
        <LoginPage />
      </PublicOnly>
    ),
    errorElement: <RouteError />,
  },
  {
    element: (
      <RequireAuth>
        <AppShell />
      </RequireAuth>
    ),
    errorElement: <RouteError />,
    children: [
      { path: '/dashboard', element: <DashboardPage /> },
      { path: '/notes', element: s(<NotesPage />) },
      // "new" and existing notes share one route so the editor stays mounted when a new note is first saved.
      { path: '/notes/:noteId', element: s(<NoteEditorPage />) },
      { path: '/modules', element: s(<ModulesPage />) },
      { path: '/modules/:moduleId', element: s(<ModuleDetailPage />) },
      { path: '/calendar', element: s(<CalendarPage />) },
      { path: '/search', element: s(<SearchPage />) },
      { path: '/archive', element: s(<ArchivePage />) },
      {
        path: '/settings',
        element: s(<SettingsLayout />),
        children: [
          { index: true, element: <Navigate to="/settings/account" replace /> },
          { path: 'account', element: s(<AccountSettings />) },
          { path: 'security', element: s(<SecuritySettings />) },
          { path: 'appearance', element: s(<AppearanceSettings />) },
          { path: 'data', element: s(<DataSettings />) },
        ],
      },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];

export const router = createBrowserRouter(routes);
