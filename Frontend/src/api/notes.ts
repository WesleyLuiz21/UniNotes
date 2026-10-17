import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { invalidateNoteLists, qk, queryClient } from '@/lib/queryClient';
import type {
  Attachment,
  Note,
  NoteFilters,
  NoteSummary,
  NoteVersion,
  NoteVersionSummary,
  Paged,
} from '@/lib/types';

export function useNotes(filters: NoteFilters, enabled = true) {
  return useQuery({
    queryKey: qk.notes(filters),
    queryFn: ({ signal }) =>
      api.getPaged<NoteSummary>('/notes', { ...filters }, signal) as Promise<Paged<NoteSummary>>,
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useSearch(filters: NoteFilters, enabled = true) {
  return useQuery({
    queryKey: qk.search(filters),
    queryFn: ({ signal }) =>
      api.getPaged<NoteSummary>('/search', { ...filters }, signal) as Promise<Paged<NoteSummary>>,
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useNote(id: string | undefined, opts: { includeDeleted?: boolean } = {}) {
  return useQuery({
    queryKey: qk.note(id ?? ''),
    queryFn: ({ signal }) =>
      api.get<Note>(`/notes/${id}`, opts.includeDeleted ? { includeDeleted: 'true' } : undefined, signal),
    enabled: Boolean(id),
    staleTime: 0,
  });
}

export interface CreateNoteInput {
  title?: string;
  markdownContent?: string;
  moduleId?: string | null;
  lectureDate: string;
  tags?: string[];
  isFavourite?: boolean;
}

export const createNote = (body: CreateNoteInput) => api.post<Note>('/notes', body);
export const patchNote = (id: string, body: Partial<Note> & { revision?: number }) =>
  api.patch<Note>(`/notes/${id}`, body);

function afterNoteChange(note?: Note) {
  if (note) queryClient.setQueryData(qk.note(note.id), note);
  invalidateNoteLists();
}

export function useCreateNote() {
  return useMutation({ mutationFn: createNote, onSuccess: afterNoteChange });
}

/** Metadata-only update (favourite, module, date, tags) — no revision required. */
export function useUpdateNoteMeta() {
  return useMutation({
    mutationFn: ({
      id,
      ...body
    }: {
      id: string;
      isFavourite?: boolean;
      moduleId?: string | null;
      lectureDate?: string;
      tags?: string[];
    }) => patchNote(id, body),
    onSuccess: afterNoteChange,
  });
}

type Action = 'archive' | 'unarchive' | 'restore';
export function useNoteAction() {
  return useMutation({
    mutationFn: ({ id, action }: { id: string; action: Action }) => api.post<Note>(`/notes/${id}/${action}`),
    onSuccess: afterNoteChange,
  });
}

export function useDeleteNote() {
  return useMutation({
    mutationFn: (id: string) => api.delete(`/notes/${id}`),
    onSuccess: (_d, id) => {
      queryClient.removeQueries({ queryKey: qk.note(id) });
      invalidateNoteLists();
    },
  });
}

export function usePermanentDelete() {
  return useMutation({
    mutationFn: (body: { ids?: string[]; all?: boolean }) =>
      api.post<{ deleted: number }>('/notes/permanent-delete', body),
    onSuccess: invalidateNoteLists,
  });
}

export function useVersions(noteId: string, enabled: boolean) {
  return useQuery({
    queryKey: qk.versions(noteId),
    queryFn: () => api.get<NoteVersionSummary[]>(`/notes/${noteId}/versions`),
    enabled,
    staleTime: 0,
  });
}

export function useVersion(noteId: string, versionId: string | null) {
  return useQuery({
    queryKey: qk.version(noteId, versionId ?? ''),
    queryFn: () => api.get<NoteVersion>(`/notes/${noteId}/versions/${versionId}`),
    enabled: Boolean(versionId),
    staleTime: Infinity,
  });
}

export function useSaveVersion() {
  return useMutation({
    mutationFn: (noteId: string) => api.post<NoteVersionSummary>(`/notes/${noteId}/versions`),
    onSuccess: (_d, noteId) => queryClient.invalidateQueries({ queryKey: qk.versions(noteId) }),
  });
}

export function useRestoreVersion() {
  return useMutation({
    mutationFn: ({ noteId, versionId }: { noteId: string; versionId: string }) =>
      api.post<Note>(`/notes/${noteId}/versions/${versionId}/restore`),
    onSuccess: (note) => {
      afterNoteChange(note);
      void queryClient.invalidateQueries({ queryKey: qk.versions(note.id) });
    },
  });
}

export function useAttachments(noteId: string | undefined) {
  return useQuery({
    queryKey: qk.attachments(noteId ?? ''),
    queryFn: () => api.get<Attachment[]>(`/notes/${noteId}/attachments`),
    enabled: Boolean(noteId),
  });
}

export async function uploadAttachment(noteId: string, file: File) {
  const form = new FormData();
  form.set('noteId', noteId);
  form.set('file', file, file.name || 'pasted-image.png');
  const att = await api.upload<Attachment>('/attachments', form);
  void queryClient.invalidateQueries({ queryKey: qk.attachments(noteId) });
  return att;
}

export function useDeleteAttachment(noteId: string) {
  return useMutation({
    mutationFn: (id: string) => api.delete(`/attachments/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.attachments(noteId) }),
  });
}

export async function importMarkdown(input: {
  file: File;
  moduleId: string | null;
  lectureDate: string;
  title?: string;
  tags?: string;
  allowDuplicate?: boolean;
}) {
  const form = new FormData();
  form.set('file', input.file);
  form.set('lectureDate', input.lectureDate);
  if (input.moduleId) form.set('moduleId', input.moduleId);
  if (input.title) form.set('title', input.title);
  if (input.tags) form.set('tags', input.tags);
  if (input.allowDuplicate) form.set('allowDuplicate', 'true');
  const note = await api.upload<Note>('/import', form);
  invalidateNoteLists();
  return note;
}

export const exportUrls = {
  noteMarkdown: (id: string) => `/api/export/notes/${id}/markdown`,
  noteZip: (id: string) => `/api/export/notes/${id}/zip`,
  moduleZip: (id: string) => `/api/export/modules/${id}/zip`,
  all: (includeVersions = true) => `/api/export/all?includeVersions=${includeVersions}`,
};
