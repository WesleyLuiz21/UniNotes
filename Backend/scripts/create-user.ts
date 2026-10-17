/**
 * Create the UniNotes account. There is no public registration; this is the only way to provision users.
 * Safe to re-run: it never modifies or overwrites an existing account.
 *
 * Interactive:      npm run user:create
 * Non-interactive:  printf '%s' "$PASSWORD" | node dist/scripts/create-user.js --username alice \
 *                     --email alice@example.com --display-name "Alice" --password-stdin
 * Options: --additional  allow creating a user when one already exists (multi-user is not exposed in the UI in V1)
 */
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '../src/lib/password.js';
import { migrationStatus } from '../src/db/migrations.js';
import {
  countUsers,
  createUser,
  findUserByIdentifier,
  UsernameSchema,
} from '../src/services/users.service.js';
import { z } from 'zod';
import { arg, cliContext, fail, flag, prompt, readStdin } from './_cli.js';

const { db } = cliContext();
if (migrationStatus(db).pending.length > 0)
  fail('Database is not migrated. Run the migration command first.');

const existing = countUsers(db);
if (existing > 0 && !flag('additional')) {
  console.log('An account already exists. Nothing was changed.');
  console.log('To reset a forgotten password use the reset-password command.');
  process.exit(0);
}

const interactive = !flag('password-stdin');
const username = (arg('username') || (interactive ? await prompt('Username: ') : '')).trim();
const parsedUsername = UsernameSchema.safeParse(username);
if (!parsedUsername.success) fail(`Invalid username: ${parsedUsername.error.issues[0]?.message}`);

const email = (arg('email') ?? (interactive ? await prompt('Email (optional): ') : '')).trim();
if (email && !z.email().safeParse(email).success) fail('Invalid email address');
const displayName = (
  arg('display-name') ||
  (interactive ? await prompt(`Display name [${username}]: `) : '') ||
  username
).trim();

if (findUserByIdentifier(db, username) || (email && findUserByIdentifier(db, email))) {
  fail('A user with that username or email already exists. Nothing was changed.');
}

let password: string;
if (interactive) {
  password = await prompt(`Password (min ${PASSWORD_MIN_LENGTH} chars): `, { hidden: true });
  const confirm = await prompt('Confirm password: ', { hidden: true });
  if (password !== confirm) fail('Passwords do not match');
} else {
  password = await readStdin();
}
if (password.length < PASSWORD_MIN_LENGTH || password.length > PASSWORD_MAX_LENGTH) {
  fail(`Password must be between ${PASSWORD_MIN_LENGTH} and ${PASSWORD_MAX_LENGTH} characters`);
}
if (password.toLowerCase().includes(username.toLowerCase())) fail('Password must not contain the username');

const user = await createUser(db, { username, email: email || null, displayName, password });
console.log(`Created account "${user.username}". You can now sign in.`);
db.$client.close();
