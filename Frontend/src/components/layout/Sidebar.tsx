import { NavLink, useNavigate } from 'react-router';
import { PanelLeftClose, PanelLeftOpen, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip } from '@/components/ui/misc';
import { cn, modKey } from '@/lib/utils';
import { Logo } from './Logo';
import { mainNav, settingsNav } from './nav';
import { UserMenu } from './UserMenu';

function NavItem({
  to,
  label,
  icon: Icon,
  collapsed,
  onNavigate,
}: {
  to: string;
  label: string;
  icon: typeof Plus;
  collapsed?: boolean;
  onNavigate?: () => void;
}) {
  const link = (
    <NavLink
      to={to}
      onClick={onNavigate}
      className={({ isActive }) =>
        cn(
          'text-muted-foreground hover:bg-hover hover:text-foreground flex h-9 items-center gap-3 rounded-md px-2.5 text-sm font-medium transition-colors',
          isActive && 'bg-primary/10 text-accent hover:bg-primary/15 hover:text-accent',
          collapsed && 'justify-center px-0',
        )
      }
    >
      <Icon className="size-[18px] shrink-0" aria-hidden />
      {collapsed ? <span className="sr-only">{label}</span> : label}
    </NavLink>
  );
  return collapsed ? (
    <Tooltip content={label} side="right">
      {link}
    </Tooltip>
  ) : (
    link
  );
}

export function SidebarContent({
  collapsed,
  onToggle,
  onNavigate,
}: {
  collapsed?: boolean;
  onToggle?: () => void;
  onNavigate?: () => void;
}) {
  const navigate = useNavigate();
  return (
    <div className="flex h-full flex-col gap-2 p-3">
      <div className={cn('flex h-10 items-center justify-between', collapsed && 'h-auto flex-col gap-2')}>
        <NavLink to="/dashboard" onClick={onNavigate} className="rounded-md" aria-label="UniNotes home">
          <Logo collapsed={collapsed} />
        </NavLink>
        {onToggle && (
          <Tooltip content={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} side="right">
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onToggle}
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
            </Button>
          </Tooltip>
        )}
      </div>

      <Tooltip content={`New note (${modKey}+Alt+N)`} side="right">
        <Button
          className={cn('my-2 justify-start', collapsed && 'justify-center px-0')}
          onClick={() => {
            onNavigate?.();
            navigate('/notes/new');
          }}
          aria-label="New note"
        >
          <Plus />
          {!collapsed && 'New note'}
        </Button>
      </Tooltip>

      <nav aria-label="Main" className="grid gap-0.5">
        {mainNav.map((item) => (
          <NavItem key={item.to} {...item} collapsed={collapsed} onNavigate={onNavigate} />
        ))}
      </nav>

      <div className="border-border mt-auto grid gap-1 border-t pt-2">
        <NavItem {...settingsNav} collapsed={collapsed} onNavigate={onNavigate} />
        <UserMenu collapsed={collapsed} />
      </div>
    </div>
  );
}

export function Sidebar({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  return (
    <aside
      className={cn(
        'border-border bg-sidebar sticky top-0 hidden h-dvh shrink-0 border-r transition-[width] duration-150 lg:block',
        collapsed ? 'w-[68px]' : 'w-60',
      )}
      aria-label="Sidebar"
    >
      <SidebarContent collapsed={collapsed} onToggle={onToggle} />
    </aside>
  );
}
