import { useEffect, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router';
import { Dialog as D } from 'radix-ui';
import { useSession } from '@/api/auth';
import { useUpdatePreferences } from '@/api/settings';
import { Dialog, SheetContent } from '@/components/ui/dialog';
import { useHotkey } from '@/hooks/useHotkey';
import { PageMetaProvider } from '@/hooks/usePageMeta';
import { QuickSearch } from './QuickSearch';
import { Sidebar, SidebarContent } from './Sidebar';
import { TopBar } from './TopBar';

export function AppShell() {
  const { data } = useSession();
  const updatePrefs = useUpdatePreferences();
  const [collapsed, setCollapsed] = useState(data?.user?.preferences.sidebarCollapsed ?? false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => setMobileOpen(false), [location.pathname]);
  useHotkey('mod+k', () => setSearchOpen(true));
  useHotkey('mod+alt+n', () => navigate('/notes/new'));

  const toggle = () => {
    setCollapsed((c) => {
      updatePrefs.mutate({ sidebarCollapsed: !c });
      return !c;
    });
  };

  return (
    <PageMetaProvider>
      <a
        href="#main"
        className="bg-primary text-primary-foreground sr-only z-50 rounded-md px-3 py-2 focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        Skip to content
      </a>
      <div className="flex min-h-dvh">
        <Sidebar collapsed={collapsed} onToggle={toggle} />
        <Dialog open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetContent aria-describedby={undefined}>
            <D.Title className="sr-only">Navigation</D.Title>
            <SidebarContent onNavigate={() => setMobileOpen(false)} />
          </SheetContent>
        </Dialog>
        <div className="flex min-w-0 flex-1 flex-col">
          <TopBar onOpenMenu={() => setMobileOpen(true)} onOpenSearch={() => setSearchOpen(true)} />
          <main id="main" className="flex min-w-0 flex-1 flex-col" tabIndex={-1}>
            <Outlet />
          </main>
        </div>
      </div>
      <QuickSearch open={searchOpen} onOpenChange={setSearchOpen} />
    </PageMetaProvider>
  );
}
