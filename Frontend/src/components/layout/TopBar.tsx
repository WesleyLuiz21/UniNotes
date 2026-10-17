import { Fragment } from 'react';
import { Link } from 'react-router';
import { ChevronRight, Menu, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { usePageMetaValue } from '@/hooks/usePageMeta';
import { modKey } from '@/lib/utils';
import { UserMenu } from './UserMenu';

export function TopBar({ onOpenMenu, onOpenSearch }: { onOpenMenu: () => void; onOpenSearch: () => void }) {
  const { title, crumbs } = usePageMetaValue();
  return (
    <header className="border-border bg-background/95 supports-[backdrop-filter]:bg-background/80 sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b px-3 backdrop-blur sm:px-5">
      <Button
        variant="ghost"
        size="icon"
        className="lg:hidden"
        onClick={onOpenMenu}
        aria-label="Open navigation"
      >
        <Menu />
      </Button>
      <nav aria-label="Breadcrumb" className="min-w-0 flex-1">
        <ol className="flex min-w-0 items-center gap-1 text-sm">
          {crumbs.map((c, i) => (
            <Fragment key={i}>
              <li className="hidden shrink-0 sm:block">
                {c.to ? (
                  <Link to={c.to} className="text-muted-foreground hover:text-foreground">
                    {c.label}
                  </Link>
                ) : (
                  <span className="text-muted-foreground">{c.label}</span>
                )}
              </li>
              <li aria-hidden className="text-muted-foreground hidden sm:block">
                <ChevronRight className="size-3.5" />
              </li>
            </Fragment>
          ))}
          <li className="min-w-0 truncate font-medium" aria-current="page">
            {title}
          </li>
        </ol>
      </nav>
      <Button
        variant="outline"
        size="sm"
        className="text-muted-foreground hidden w-56 justify-start md:inline-flex"
        onClick={onOpenSearch}
      >
        <Search />
        <span className="flex-1 text-left">Search notes…</span>
        <kbd className="border-border rounded border px-1.5 font-mono text-[11px]">{modKey} K</kbd>
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="md:hidden"
        onClick={onOpenSearch}
        aria-label="Search notes"
      >
        <Search />
      </Button>
      <div className="lg:hidden">
        <UserMenu compact />
      </div>
    </header>
  );
}
