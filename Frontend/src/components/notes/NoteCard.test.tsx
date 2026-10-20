import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderWithProviders } from '@/test/utils';
import type { NoteSummary } from '@/lib/types';
import { NoteCard } from './NoteCard';

const base: NoteSummary = {
  id: 'n1',
  title: 'Normalisation',
  excerpt: 'Third normal form',
  moduleId: null,
  module: null,
  lectureDate: null,
  isFavourite: false,
  revision: 1,
  tags: [],
  createdAt: '2025-01-01T00:00:00Z',
  updatedAt: '2025-01-01T00:00:00Z',
  archivedAt: null,
  deletedAt: null,
};

describe('NoteCard', () => {
  it('shows "Undated" for notes without a lecture date', () => {
    renderWithProviders(<NoteCard note={base} />);
    expect(screen.getByRole('link', { name: 'Normalisation' })).toBeInTheDocument();
    expect(screen.getByText('Undated')).toBeInTheDocument();
  });

  it('shows the lecture date when there is one', () => {
    renderWithProviders(<NoteCard note={{ ...base, lectureDate: '2024-03-12' }} />);
    expect(screen.getByText('12 Mar 2024')).toBeInTheDocument();
  });
});
