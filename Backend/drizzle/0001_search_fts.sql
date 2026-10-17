-- Full-text search index for notes (SQLite FTS5).
-- This is a standalone FTS table maintained by the application inside the same transaction
-- as every note mutation (see src/services/search-index.ts), because the indexed document
-- combines columns from notes, modules and tags.
-- Soft-deleted/archived notes stay indexed; queries join back to notes to apply filters.
CREATE VIRTUAL TABLE `notes_fts` USING fts5(
  `note_id` UNINDEXED,
  `title`,
  `content`,
  `tags`,
  `module`,
  tokenize = 'unicode61 remove_diacritics 2',
  prefix = '2 3'
);
