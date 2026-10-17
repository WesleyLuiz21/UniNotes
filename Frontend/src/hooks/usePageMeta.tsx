import * as React from 'react';

export interface Crumb {
  label: string;
  to?: string;
}
interface PageMeta {
  title: string;
  crumbs: Crumb[];
}

const PageMetaContext = React.createContext<{ meta: PageMeta; set: (m: PageMeta) => void } | null>(null);

export function PageMetaProvider({ children }: { children: React.ReactNode }) {
  const [meta, set] = React.useState<PageMeta>({ title: '', crumbs: [] });
  const value = React.useMemo(() => ({ meta, set }), [meta]);
  return <PageMetaContext.Provider value={value}>{children}</PageMetaContext.Provider>;
}

export const usePageMetaValue = () => React.useContext(PageMetaContext)?.meta ?? { title: '', crumbs: [] };

/** Set the top-bar title/breadcrumbs and the document title for the current page. */
export function usePageMeta(title: string, crumbs: Crumb[] = []) {
  const ctx = React.useContext(PageMetaContext);
  const key = JSON.stringify(crumbs);
  React.useEffect(() => {
    document.title = title ? `${title} · UniNotes` : 'UniNotes';
    ctx?.set({ title, crumbs: JSON.parse(key) as Crumb[] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, key]);
}
