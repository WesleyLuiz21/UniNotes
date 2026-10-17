import { NavLink, Outlet } from 'react-router';
import { Database, Palette, ShieldCheck, UserRound } from 'lucide-react';
import { Page, PageHeader } from '@/components/layout/Page';
import { cn } from '@/lib/utils';

const items = [
  { to: '/settings/account', label: 'Account', icon: UserRound },
  { to: '/settings/security', label: 'Security', icon: ShieldCheck },
  { to: '/settings/appearance', label: 'Appearance', icon: Palette },
  { to: '/settings/data', label: 'Data', icon: Database },
];

export default function SettingsLayout() {
  return (
    <Page>
      <PageHeader title="Settings" />
      <div className="grid gap-6 md:grid-cols-[200px_1fr]">
        <nav aria-label="Settings" className="flex gap-1 overflow-x-auto md:flex-col">
          {items.map((i) => (
            <NavLink
              key={i.to}
              to={i.to}
              className={({ isActive }) =>
                cn(
                  'text-muted-foreground hover:bg-hover hover:text-foreground flex h-9 shrink-0 items-center gap-2 rounded-md px-3 text-sm font-medium',
                  isActive && 'bg-primary/10 text-accent',
                )
              }
            >
              <i.icon className="size-4" aria-hidden /> {i.label}
            </NavLink>
          ))}
        </nav>
        <div className="min-w-0">
          <Outlet />
        </div>
      </div>
    </Page>
  );
}
