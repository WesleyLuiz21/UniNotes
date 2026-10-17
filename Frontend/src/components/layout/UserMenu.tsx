import { useNavigate } from 'react-router';
import { ChevronsUpDown, LogOut, Monitor, Moon, Settings, ShieldCheck, Sun } from 'lucide-react';
import { useLogout, useSession } from '@/api/auth';
import { useUpdatePreferences } from '@/api/settings';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useTheme, type ThemePreference } from '@/lib/theme';
import { cn } from '@/lib/utils';

export function UserMenu({ collapsed, compact }: { collapsed?: boolean; compact?: boolean }) {
  const { data } = useSession();
  const logout = useLogout();
  const navigate = useNavigate();
  const { setPreference } = useTheme();
  const updatePrefs = useUpdatePreferences();
  const user = data?.user;
  if (!user) return null;
  const initials = user.displayName
    .split(/\s+/)
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  const setTheme = (t: ThemePreference) => {
    setPreference(t);
    updatePrefs.mutate({ theme: t });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          'hover:bg-hover flex items-center gap-2 rounded-md text-left text-sm',
          compact ? 'size-9 justify-center' : 'h-11 w-full px-2',
          collapsed && 'justify-center px-0',
        )}
        aria-label="Account menu"
      >
        <span
          className="bg-primary/15 text-accent grid size-7 shrink-0 place-items-center rounded-full text-xs font-semibold"
          aria-hidden
        >
          {initials}
        </span>
        {!collapsed && !compact && (
          <>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{user.displayName}</span>
              <span className="text-muted-foreground block truncate text-xs">
                {user.email ?? user.username}
              </span>
            </span>
            <ChevronsUpDown className="text-muted-foreground size-4" aria-hidden />
          </>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align={compact ? 'end' : 'start'}
        side={compact ? 'bottom' : 'top'}
        className="w-56"
      >
        <DropdownMenuLabel>Signed in as {user.username}</DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => navigate('/settings/account')}>
          <Settings /> Settings
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => navigate('/settings/security')}>
          <ShieldCheck /> Security
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Theme</DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => setTheme('light')}>
          <Sun /> Light
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setTheme('dark')}>
          <Moon /> Dark
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setTheme('system')}>
          <Monitor /> System
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() => logout.mutate(false, { onSettled: () => navigate('/login', { replace: true }) })}
        >
          <LogOut /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
