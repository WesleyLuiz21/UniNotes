import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api';
import type { Note } from '@/lib/types';
import { useAutosave } from './useAutosave';

const note = (over: Partial<Note> = {}): Note => ({
  id: 'n1',
  title: 'T',
  markdownContent: 'hello',
  moduleId: null,
  module: null,
  lectureDate: '2025-01-01',
  isFavourite: false,
  revision: 1,
  tags: [],
  createdAt: '2025-01-01T00:00:00Z',
  updatedAt: '2025-01-01T00:00:00Z',
  archivedAt: null,
  deletedAt: null,
  ...over,
});

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe('useAutosave', () => {
  it('debounces and only reports saved after the server confirms', async () => {
    let resolve!: (n: Note) => void;
    const update = vi.fn(() => new Promise<Note>((r) => (resolve = r)));
    const { result } = renderHook(() => useAutosave(note(), { create: vi.fn(), update }));
    expect(result.current.status).toBe('saved');

    act(() => result.current.setDraft({ markdownContent: 'hello w' }));
    act(() => result.current.setDraft({ markdownContent: 'hello world' }));
    expect(result.current.status).toBe('unsaved');
    await advance(900);
    expect(update).not.toHaveBeenCalled();
    await advance(200);
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith('n1', { title: 'T', markdownContent: 'hello world' }, 1);
    expect(result.current.status).toBe('saving');

    await act(async () => resolve(note({ revision: 2, markdownContent: 'hello world' })));
    expect(result.current.status).toBe('saved');
  });

  it('saves again when edits happen during an in-flight save, with the new revision', async () => {
    const resolvers: ((n: Note) => void)[] = [];
    const update = vi.fn(() => new Promise<Note>((r) => resolvers.push(r)));
    const { result } = renderHook(() => useAutosave(note(), { create: vi.fn(), update }));
    act(() => result.current.setDraft({ markdownContent: 'a' }));
    await advance(1000);
    act(() => result.current.setDraft({ markdownContent: 'ab' }));
    await act(async () => resolvers[0]!(note({ revision: 2, markdownContent: 'a' })));
    expect(result.current.status).not.toBe('saved');
    await advance(0);
    expect(update).toHaveBeenLastCalledWith('n1', { title: 'T', markdownContent: 'ab' }, 2);
    await act(async () => resolvers[1]!(note({ revision: 3, markdownContent: 'ab' })));
    expect(result.current.status).toBe('saved');
  });

  it('stops on revision conflict and keeps the local draft', async () => {
    const server = note({ revision: 5, markdownContent: 'server' });
    const update = vi
      .fn()
      .mockRejectedValue(new ApiError(409, 'REVISION_CONFLICT', 'conflict', { current: server }));
    const { result } = renderHook(() => useAutosave(note(), { create: vi.fn(), update }));
    act(() => result.current.setDraft({ markdownContent: 'mine' }));
    await advance(1100);
    expect(result.current.status).toBe('conflict');
    expect(result.current.conflict).toEqual(server);
    expect(result.current.getDraft().markdownContent).toBe('mine');
    act(() => result.current.setDraft({ markdownContent: 'mine 2' }));
    await advance(5000);
    expect(update).toHaveBeenCalledTimes(1);

    update.mockResolvedValueOnce(note({ revision: 6, markdownContent: 'mine 2' }));
    await act(async () => result.current.resolveKeepMine());
    await advance(0);
    expect(update).toHaveBeenLastCalledWith('n1', { title: 'T', markdownContent: 'mine 2' }, 5);
    expect(result.current.status).toBe('saved');
  });

  it('retries after network errors without losing the draft', async () => {
    const update = vi
      .fn()
      .mockRejectedValueOnce(new ApiError(0, 'NETWORK_ERROR', 'offline'))
      .mockResolvedValueOnce(note({ revision: 2, markdownContent: 'x' }));
    const { result } = renderHook(() => useAutosave(note(), { create: vi.fn(), update }));
    act(() => result.current.setDraft({ markdownContent: 'x' }));
    await advance(1100);
    expect(result.current.status).toBe('error');
    expect(result.current.dirty).toBe(true);
    await advance(2100);
    expect(update).toHaveBeenCalledTimes(2);
    expect(result.current.status).toBe('saved');
  });

  it('creates a new note on first content and then updates it', async () => {
    const create = vi.fn().mockResolvedValue(note({ id: 'new1', revision: 1, markdownContent: 'first' }));
    const onSaved = vi.fn();
    const { result } = renderHook(() => useAutosave(null, { create, update: vi.fn(), onSaved }));
    expect(result.current.status).toBe('idle');
    await act(async () => {
      await result.current.flush();
    });
    expect(create).not.toHaveBeenCalled(); // empty notes are not created
    act(() => result.current.setDraft({ markdownContent: 'first' }));
    await advance(1100);
    expect(create).toHaveBeenCalledWith({ title: '', markdownContent: 'first' });
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ id: 'new1' }), true);
    expect(result.current.noteId).toBe('new1');
  });
});
