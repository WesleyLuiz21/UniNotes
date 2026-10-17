import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '@/lib/api';
import type { Note } from '@/lib/types';

export type SaveStatus = 'idle' | 'unsaved' | 'saving' | 'saved' | 'error' | 'conflict';

export interface Draft {
  title: string;
  markdownContent: string;
}

export interface AutosaveDeps {
  /** Create the note on the server (first save of a new note). */
  create: (draft: Draft) => Promise<Note>;
  /** Persist content with optimistic concurrency. Must reject with ApiError 409 on conflict. */
  update: (id: string, draft: Draft, revision: number) => Promise<Note>;
  onSaved?: (note: Note, created: boolean) => void;
}

const DEBOUNCE_MS = 1000;
const RETRY_DELAYS = [2000, 5000, 10_000, 30_000];

const same = (a: Draft, b: Draft) => a.title === b.title && a.markdownContent === b.markdownContent;

/**
 * Debounced autosave with optimistic concurrency.
 *
 * Guarantees:
 *  - "Saved" is shown only after the server confirms the exact content currently in the editor.
 *  - At most one save is in flight; edits made meanwhile trigger a follow-up save.
 *  - A revision conflict stops autosaving and keeps the local draft intact until the user decides.
 *  - Network/server errors retry with backoff; the draft is never discarded.
 */
export function useAutosave(initial: Note | null, deps: AutosaveDeps) {
  const [status, setStatus] = useState<SaveStatus>(initial ? 'saved' : 'idle');
  const [conflict, setConflict] = useState<Note | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(initial?.updatedAt ?? null);
  const [error, setError] = useState<string | null>(null);

  const [currentId, setCurrentId] = useState<string | null>(initial?.id ?? null);
  const initialDraft: Draft = {
    title: initial?.title ?? '',
    markdownContent: initial?.markdownContent ?? '',
  };
  const noteId = useRef<string | null>(initial?.id ?? null);
  const revision = useRef<number>(initial?.revision ?? 0);
  const draft = useRef<Draft>(initialDraft);
  const saved = useRef<Draft>(initialDraft);
  const flushRef = useRef<(force?: boolean) => Promise<boolean>>(async () => false);
  const inFlight = useRef<Promise<void> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retries = useRef(0);
  const conflicted = useRef(false);
  const depsRef = useRef(deps);
  useEffect(() => {
    depsRef.current = deps;
  });

  const clearTimer = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };

  const flush = useCallback(async (force = false): Promise<boolean> => {
    clearTimer();
    if (conflicted.current) return false;
    if (inFlight.current) {
      await inFlight.current;
      return flushRef.current(force);
    }
    const snapshot = { ...draft.current };
    const isNew = noteId.current === null;
    if (!isNew && same(snapshot, saved.current)) {
      setStatus('saved');
      return true;
    }
    if (isNew && !force && !snapshot.title.trim() && !snapshot.markdownContent.trim()) {
      setStatus('idle');
      return true;
    }

    setStatus('saving');
    let ok = false;
    inFlight.current = (async () => {
      try {
        const note = isNew
          ? await depsRef.current.create(snapshot)
          : await depsRef.current.update(noteId.current!, snapshot, revision.current);
        noteId.current = note.id;
        setCurrentId(note.id);
        revision.current = note.revision;
        saved.current = snapshot;
        retries.current = 0;
        setError(null);
        setLastSavedAt(note.updatedAt);
        depsRef.current.onSaved?.(note, isNew);
        ok = true;
      } catch (err) {
        if (err instanceof ApiError && err.code === 'REVISION_CONFLICT') {
          conflicted.current = true;
          setConflict((err.details as { current?: Note } | undefined)?.current ?? null);
          setStatus('conflict');
        } else {
          setError(err instanceof Error ? err.message : 'Save failed');
          setStatus('error');
          // Validation errors will not fix themselves; everything else is retried.
          const permanent =
            err instanceof ApiError &&
            err.status >= 400 &&
            err.status < 500 &&
            err.status !== 408 &&
            err.status !== 429;
          if (!permanent) {
            const delay = RETRY_DELAYS[Math.min(retries.current, RETRY_DELAYS.length - 1)]!;
            retries.current++;
            timer.current = setTimeout(() => void flushRef.current(), delay);
          }
        }
      } finally {
        inFlight.current = null;
      }
    })();
    await inFlight.current;
    if (!ok) return false;
    // Edits made while saving need another round before we can claim "saved".
    if (!same(draft.current, saved.current)) {
      setStatus('unsaved');
      return flushRef.current();
    }
    setStatus('saved');
    return true;
  }, []);
  useEffect(() => {
    flushRef.current = flush;
  }, [flush]);

  const schedule = useCallback(() => {
    clearTimer();
    timer.current = setTimeout(() => void flush(), DEBOUNCE_MS);
  }, [flush]);

  const setDraft = useCallback(
    (patch: Partial<Draft>) => {
      draft.current = { ...draft.current, ...patch };
      if (conflicted.current) return;
      const isNew = noteId.current === null;
      if (!isNew && same(draft.current, saved.current)) {
        if (!inFlight.current) setStatus('saved');
        clearTimer();
        return;
      }
      setStatus((s) => (s === 'saving' ? s : 'unsaved'));
      schedule();
    },
    [schedule],
  );

  /** Conflict resolution: keep the local draft and overwrite the newer server copy. */
  const resolveKeepMine = useCallback(() => {
    if (!conflict) return;
    revision.current = conflict.revision;
    conflicted.current = false;
    setConflict(null);
    setStatus('unsaved');
    void flush();
  }, [conflict, flush]);

  /** Conflict resolution / external change: adopt a server copy as the new baseline. */
  const adoptServer = useCallback((note: Note) => {
    clearTimer();
    noteId.current = note.id;
    setCurrentId(note.id);
    revision.current = note.revision;
    draft.current = { title: note.title, markdownContent: note.markdownContent };
    saved.current = { ...draft.current };
    conflicted.current = false;
    setConflict(null);
    setLastSavedAt(note.updatedAt);
    setStatus('saved');
  }, []);

  useEffect(() => clearTimer, []);

  const dirty = status === 'unsaved' || status === 'saving' || status === 'error' || status === 'conflict';
  return {
    status,
    error,
    conflict,
    lastSavedAt,
    dirty,
    noteId: currentId,
    // Read lazily (event handlers only), never during render.
    getDraft: useCallback(() => draft.current, []),
    getNoteId: useCallback(() => noteId.current, []),
    setDraft,
    flush,
    resolveKeepMine,
    adoptServer,
  };
}
