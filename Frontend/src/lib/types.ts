// Types mirror the backend REST contract (see Backend/openapi.json).

export interface Preferences {
  theme: 'system' | 'light' | 'dark';
  editorFontSize: number;
  editorLineWrap: boolean;
  sidebarCollapsed: boolean;
  lastModuleId: string | null;
}

export interface User {
  id: string;
  username: string;
  email: string | null;
  displayName: string;
  mfaEnabled: boolean;
  passwordChangedAt: string;
  createdAt: string;
  preferences: Preferences;
}

export interface SessionState {
  status: 'anonymous' | 'mfa_required' | 'authenticated';
  user: User | null;
  csrfToken: string | null;
}

export interface Module {
  id: string;
  name: string;
  code: string | null;
  description: string;
  academicYear: string | null;
  color: string;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  noteCount: number;
}

export interface ModuleRef {
  id: string;
  name: string;
  code: string | null;
  color: string;
  academicYear: string | null;
}

export interface NoteSummary {
  id: string;
  title: string;
  excerpt: string;
  moduleId: string | null;
  module: ModuleRef | null;
  /** null = undated (not shown in the calendar). */
  lectureDate: string | null;
  isFavourite: boolean;
  revision: number;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  deletedAt: string | null;
  snippet?: string;
  titleHighlight?: string;
}

export interface Note extends Omit<NoteSummary, 'excerpt' | 'snippet' | 'titleHighlight'> {
  markdownContent: string;
}

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface NoteVersionSummary {
  id: string;
  revision: number;
  title: string;
  reason: 'autosave' | 'manual' | 'pre-restore' | 'restore' | 'import';
  createdAt: string;
  characters: number;
}

export interface NoteVersion extends Omit<NoteVersionSummary, 'characters'> {
  markdownContent: string;
}

export interface Attachment {
  id: string;
  noteId: string | null;
  kind: 'image' | 'file';
  mimeType: string;
  sizeBytes: number;
  originalName: string;
  width: number | null;
  height: number | null;
  createdAt: string;
  url: string;
}

export interface CalendarDay {
  date: string;
  count: number;
  modules: { id: string; color: string; count: number }[];
}

export interface Dashboard {
  stats: {
    totalNotes: number;
    totalModules: number;
    notesThisWeek: number;
    favourites: number;
    recentlyActiveModule: { id: string; name: string; color: string } | null;
  };
  recentNotes: NoteSummary[];
  modules: Module[];
}

export interface SecurityOverview {
  mfaEnabled: boolean;
  recoveryCodesRemaining: number;
  passwordChangedAt: string;
  sessions: {
    id: string;
    current: boolean;
    ip: string | null;
    userAgent: string | null;
    createdAt: string;
    lastSeenAt: string;
    expiresAt: string;
  }[];
}

export interface AuditEvent {
  id: string;
  type: string;
  ip: string | null;
  userAgent: string | null;
  details: Record<string, unknown>;
  createdAt: string;
}

export interface DataStats {
  notes: { active: number; archived: number; deleted: number };
  versions: number;
  attachments: { count: number; bytes: number };
  limits: { imageBytes: number; attachmentBytes: number; importBytes: number };
}

export interface NoteFilters {
  q?: string;
  status?: 'active' | 'archived' | 'all' | 'deleted';
  moduleId?: string;
  academicYear?: string;
  date?: string;
  from?: string;
  to?: string;
  tags?: string;
  favourite?: 'true' | 'false';
  updatedWithinDays?: number;
  sort?: 'relevance' | 'lecture_desc' | 'lecture_asc' | 'updated' | 'title';
  page?: number;
  pageSize?: number;
}
