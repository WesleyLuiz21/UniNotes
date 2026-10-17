import { eq, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { DB } from '../db/client.js';
import { users, type User } from '../db/schema.js';
import { newId } from '../lib/crypto.js';
import { hashPassword } from '../lib/password.js';
import { nowIso } from '../lib/time.js';

export const PreferencesSchema = z.object({
  theme: z.enum(['system', 'light', 'dark']).default('system'),
  editorFontSize: z.number().int().min(12).max(20).default(14),
  editorLineWrap: z.boolean().default(true),
  sidebarCollapsed: z.boolean().default(false),
  lastModuleId: z.uuid().nullable().default(null),
});
export type Preferences = z.infer<typeof PreferencesSchema>;

export function parsePreferences(raw: string): Preferences {
  try {
    return PreferencesSchema.parse(JSON.parse(raw));
  } catch {
    return PreferencesSchema.parse({});
  }
}

export function serializeUser(user: User) {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    displayName: user.displayName,
    mfaEnabled: Boolean(user.mfaEnabledAt),
    passwordChangedAt: user.passwordChangedAt,
    createdAt: user.createdAt,
    preferences: parsePreferences(user.preferences),
  };
}

export const normaliseIdentifier = (value: string) => value.trim().toLowerCase();

export function findUserByIdentifier(db: DB, identifier: string): User | undefined {
  const id = normaliseIdentifier(identifier);
  return db
    .select()
    .from(users)
    .where(or(eq(users.username, id), eq(sql`lower(${users.email})`, id)))
    .get();
}

export const getUser = (db: DB, id: string) => db.select().from(users).where(eq(users.id, id)).get();

export const countUsers = (db: DB) =>
  db
    .select({ n: sql<number>`count(*)` })
    .from(users)
    .get()?.n ?? 0;

export async function createUser(
  db: DB,
  input: { username: string; email?: string | null; displayName: string; password: string },
): Promise<User> {
  const now = nowIso();
  const row = {
    id: newId(),
    username: normaliseIdentifier(input.username),
    email: input.email ? normaliseIdentifier(input.email) : null,
    displayName: input.displayName.trim(),
    passwordHash: await hashPassword(input.password),
    preferences: JSON.stringify(PreferencesSchema.parse({})),
    passwordChangedAt: now,
    createdAt: now,
    updatedAt: now,
  };
  db.insert(users).values(row).run();
  return getUser(db, row.id)!;
}

export const UsernameSchema = z
  .string()
  .trim()
  .min(3)
  .max(40)
  .regex(/^[a-zA-Z0-9._-]+$/, 'Use letters, numbers, dots, dashes or underscores');
