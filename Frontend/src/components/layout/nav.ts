import { Archive, CalendarDays, FileText, LayoutDashboard, Library, Search, Settings } from 'lucide-react';

export const mainNav = [
  { to: '/dashboard', label: 'Home', icon: LayoutDashboard },
  { to: '/notes', label: 'Notes', icon: FileText },
  { to: '/modules', label: 'Modules', icon: Library },
  { to: '/calendar', label: 'Calendar', icon: CalendarDays },
  { to: '/search', label: 'Search', icon: Search },
  { to: '/archive', label: 'Archive', icon: Archive },
] as const;

export const settingsNav = { to: '/settings', label: 'Settings', icon: Settings } as const;
