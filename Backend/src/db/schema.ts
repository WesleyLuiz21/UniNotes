import { sql } from 'drizzle-orm';
import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

// Conventions:
// - IDs are opaque random UUIDs (text).
// - Timestamps are ISO-8601 UTC strings (lexicographically sortable).
// - lecture_date is a date-only string (YYYY-MM-DD) so it never shifts across time zones; it may be null.
// - Every user-owned table carries user_id so queries can be ownership-scoped.

const timestamps = {
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
};

export const users = sqliteTable(
  'users',
  {
    id: text('id').primaryKey(),
    username: text('username').notNull(),
    email: text('email'),
    displayName: text('display_name').notNull(),
    passwordHash: text('password_hash').notNull(),
    // TOTP secrets are AES-256-GCM encrypted with APP_SECRET_KEY.
    mfaSecretEnc: text('mfa_secret_enc'),
    mfaPendingSecretEnc: text('mfa_pending_secret_enc'),
    mfaEnabledAt: text('mfa_enabled_at'),
    // Last accepted TOTP time step, to prevent code replay within the validity window.
    mfaLastStep: integer('mfa_last_step'),
    preferences: text('preferences').notNull().default('{}'),
    passwordChangedAt: text('password_changed_at').notNull(),
    ...timestamps,
  },
  (t) => [uniqueIndex('users_username_uq').on(t.username), uniqueIndex('users_email_uq').on(t.email)],
);

export const sessions = sqliteTable(
  'sessions',
  {
    // SHA-256 of the session token; the raw token only ever exists in the cookie.
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    state: text('state', { enum: ['active', 'mfa_pending'] }).notNull(),
    csrfToken: text('csrf_token').notNull(),
    ip: text('ip'),
    userAgent: text('user_agent'),
    createdAt: text('created_at').notNull(),
    lastSeenAt: text('last_seen_at').notNull(),
    expiresAt: text('expires_at').notNull(),
    absoluteExpiresAt: text('absolute_expires_at').notNull(),
  },
  (t) => [index('sessions_user_idx').on(t.userId), index('sessions_expires_idx').on(t.expiresAt)],
);

export const recoveryCodes = sqliteTable(
  'recovery_codes',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    codeHash: text('code_hash').notNull(),
    usedAt: text('used_at'),
    createdAt: text('created_at').notNull(),
  },
  (t) => [index('recovery_codes_user_idx').on(t.userId)],
);

export const modules = sqliteTable(
  'modules',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    code: text('code'),
    description: text('description').notNull().default(''),
    academicYear: text('academic_year'),
    color: text('color').notNull(),
    archivedAt: text('archived_at'),
    ...timestamps,
  },
  (t) => [index('modules_user_idx').on(t.userId, t.archivedAt)],
);

export const notes = sqliteTable(
  'notes',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // Deleting a module keeps its notes; they become unassigned.
    moduleId: text('module_id').references(() => modules.id, { onDelete: 'set null' }),
    title: text('title').notNull(),
    markdownContent: text('markdown_content').notNull().default(''),
    // Null when the date is unknown (e.g. undated imported notes); such notes never appear in the calendar.
    lectureDate: text('lecture_date'),
    isFavourite: integer('is_favourite', { mode: 'boolean' }).notNull().default(false),
    revision: integer('revision').notNull().default(1),
    // SHA-256 of imported content, used to detect duplicate imports.
    sourceHash: text('source_hash'),
    lastVersionAt: text('last_version_at'),
    archivedAt: text('archived_at'),
    ...timestamps,
    deletedAt: text('deleted_at'),
  },
  (t) => [
    index('notes_user_updated_idx').on(t.userId, t.deletedAt, t.updatedAt),
    index('notes_user_lecture_idx').on(t.userId, t.deletedAt, t.lectureDate),
    index('notes_module_idx').on(t.moduleId),
    index('notes_source_hash_idx').on(t.userId, t.sourceHash),
  ],
);

export const noteVersions = sqliteTable(
  'note_versions',
  {
    id: text('id').primaryKey(),
    noteId: text('note_id')
      .notNull()
      .references(() => notes.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    revision: integer('revision').notNull(),
    title: text('title').notNull(),
    markdownContent: text('markdown_content').notNull(),
    reason: text('reason', { enum: ['autosave', 'manual', 'pre-restore', 'restore', 'import'] }).notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [index('note_versions_note_idx').on(t.noteId, t.createdAt)],
);

export const attachments = sqliteTable(
  'attachments',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // Attachments are uploaded in the context of a note; cleanup on permanent deletion is explicit.
    noteId: text('note_id').references(() => notes.id, { onDelete: 'set null' }),
    kind: text('kind', { enum: ['image', 'file'] }).notNull(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    originalName: text('original_name').notNull(),
    // Opaque random file name inside ATTACHMENTS_DIR; never derived from user input.
    storageKey: text('storage_key').notNull(),
    sha256: text('sha256').notNull(),
    width: integer('width'),
    height: integer('height'),
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    index('attachments_user_idx').on(t.userId),
    index('attachments_note_idx').on(t.noteId),
    uniqueIndex('attachments_storage_key_uq').on(t.storageKey),
  ],
);

export const tags = sqliteTable(
  'tags',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [uniqueIndex('tags_user_name_uq').on(t.userId, t.name)],
);

export const noteTags = sqliteTable(
  'note_tags',
  {
    noteId: text('note_id')
      .notNull()
      .references(() => notes.id, { onDelete: 'cascade' }),
    tagId: text('tag_id')
      .notNull()
      .references(() => tags.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.noteId, t.tagId] }), index('note_tags_tag_idx').on(t.tagId)],
);

export const auditEvents = sqliteTable(
  'audit_events',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    ip: text('ip'),
    userAgent: text('user_agent'),
    details: text('details').notNull().default('{}'),
    createdAt: text('created_at')
      .notNull()
      .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
  },
  (t) => [index('audit_events_user_idx').on(t.userId, t.createdAt)],
);

export type User = typeof users.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type Module = typeof modules.$inferSelect;
export type Note = typeof notes.$inferSelect;
export type NoteVersion = typeof noteVersions.$inferSelect;
export type Attachment = typeof attachments.$inferSelect;
