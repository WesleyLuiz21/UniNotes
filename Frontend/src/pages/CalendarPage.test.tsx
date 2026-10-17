import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { PageMetaProvider } from '@/hooks/usePageMeta';
import { mockApi, renderRoutes } from '@/test/utils';
import CalendarPage from './CalendarPage';

const note = {
  id: 'n1',
  title: 'Graph theory',
  excerpt: 'Trees',
  moduleId: null,
  module: null,
  lectureDate: '2024-03-12',
  isFavourite: false,
  revision: 1,
  tags: [],
  createdAt: '2025-01-01T00:00:00Z',
  updatedAt: '2025-01-01T00:00:00Z',
  archivedAt: null,
  deletedAt: null,
};

describe('CalendarPage', () => {
  it('highlights dates with notes and lists notes for the selected date', async () => {
    const { calls } = mockApi((url) => {
      if (url.pathname === '/api/calendar') return { body: [{ date: '2024-03-12', count: 1, modules: [] }] };
      if (url.pathname === '/api/modules') return { body: [] };
      if (url.pathname === '/api/notes') {
        const items = url.searchParams.get('date') === '2024-03-12' ? [note] : [];
        return { body: items };
      }
    });
    renderRoutes(
      [
        {
          path: '/calendar',
          element: (
            <PageMetaProvider>
              <CalendarPage />
            </PageMetaProvider>
          ),
        },
      ],
      ['/calendar?date=2024-03-01'],
    );
    expect(
      await screen.findByRole('heading', { name: 'March 2024', exact: true } as never),
    ).toBeInTheDocument();
    const day = await screen.findByRole('button', { name: 'Tuesday 12 March 2024, 1 note' });
    // The calendar asks for lecture-date ranges, never creation timestamps.
    const cal = calls.find((c) => c.url.pathname === '/api/calendar')!;
    expect(cal.url.searchParams.get('from')).toBe('2024-02-26');
    expect(cal.url.searchParams.get('to')).toBe('2024-03-31');

    await userEvent.click(day);
    expect(await screen.findByRole('heading', { name: 'Tuesday 12 March 2024' })).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: 'Graph theory' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Next month' }));
    expect(await screen.findByRole('heading', { name: 'April 2024' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('radio', { name: 'Week' }));
    const week = await screen.findByRole('list', { name: /Week of/ });
    expect(week.children).toHaveLength(7);
    void within;
  });
});
