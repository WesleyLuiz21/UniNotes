import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { mockApi, renderWithProviders } from '@/test/utils';
import { NoteFilters } from './NoteFilters';

const modules = [
  {
    id: 'm1',
    name: 'Algorithms',
    code: 'CS201',
    academicYear: '2025/26',
    color: '#3B82F6',
    archivedAt: null,
    description: '',
    noteCount: 1,
    createdAt: '',
    updatedAt: '',
  },
  {
    id: 'm2',
    name: 'Physics',
    code: null,
    academicYear: '2024/25',
    color: '#10B981',
    archivedAt: null,
    description: '',
    noteCount: 0,
    createdAt: '',
    updatedAt: '',
  },
];

describe('NoteFilters', () => {
  it('emits filter changes and can clear them', async () => {
    mockApi((url) => {
      if (url.pathname === '/api/modules') return { body: modules };
      if (url.pathname === '/api/tags') return { body: [{ name: 'exam', count: 2 }] };
    });
    const onChange = vi.fn();
    renderWithProviders(<NoteFilters value={{ moduleId: 'm1' }} onChange={onChange} />);
    expect(await screen.findByRole('option', { name: 'CS201 · Algorithms' })).toBeInTheDocument();
    await screen.findByRole('option', { name: '2024/25' });
    await screen.findByRole('option', { name: '#exam (2)' });

    await userEvent.selectOptions(screen.getByLabelText('Module'), 'm2');
    expect(onChange).toHaveBeenLastCalledWith({ moduleId: 'm2' });
    await userEvent.selectOptions(screen.getByLabelText('Academic year'), '2024/25');
    expect(onChange).toHaveBeenLastCalledWith({ academicYear: '2024/25' });
    await userEvent.selectOptions(screen.getByLabelText('Sort by'), 'title');
    expect(onChange).toHaveBeenLastCalledWith({ sort: 'title' });
    await userEvent.click(screen.getByLabelText('Favourites only'));
    expect(onChange).toHaveBeenLastCalledWith({ favourite: 'true' });
    await userEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ moduleId: undefined, favourite: undefined }),
    );
  });
});
