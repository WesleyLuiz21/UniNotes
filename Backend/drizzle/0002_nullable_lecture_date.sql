-- Make notes.lecture_date nullable (undated notes). SQLite cannot drop NOT NULL in place, so the
-- table is rebuilt (https://www.sqlite.org/lang_altertable.html#otheralter). Every row is copied
-- unchanged. runMigrations() turns foreign_keys OFF around the migration transaction (PRAGMA
-- foreign_keys is a no-op inside a transaction) so DROP TABLE does not cascade into note_versions,
-- note_tags or attachments, and runs PRAGMA foreign_key_check before committing.
CREATE TABLE `__new_notes` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`module_id` text,
	`title` text NOT NULL,
	`markdown_content` text DEFAULT '' NOT NULL,
	`lecture_date` text,
	`is_favourite` integer DEFAULT false NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`source_hash` text,
	`last_version_at` text,
	`archived_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`module_id`) REFERENCES `modules`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_notes`("id", "user_id", "module_id", "title", "markdown_content", "lecture_date", "is_favourite", "revision", "source_hash", "last_version_at", "archived_at", "created_at", "updated_at", "deleted_at") SELECT "id", "user_id", "module_id", "title", "markdown_content", "lecture_date", "is_favourite", "revision", "source_hash", "last_version_at", "archived_at", "created_at", "updated_at", "deleted_at" FROM `notes`;--> statement-breakpoint
DROP TABLE `notes`;--> statement-breakpoint
ALTER TABLE `__new_notes` RENAME TO `notes`;--> statement-breakpoint
CREATE INDEX `notes_user_updated_idx` ON `notes` (`user_id`,`deleted_at`,`updated_at`);--> statement-breakpoint
CREATE INDEX `notes_user_lecture_idx` ON `notes` (`user_id`,`deleted_at`,`lecture_date`);--> statement-breakpoint
CREATE INDEX `notes_module_idx` ON `notes` (`module_id`);--> statement-breakpoint
CREATE INDEX `notes_source_hash_idx` ON `notes` (`user_id`,`source_hash`);