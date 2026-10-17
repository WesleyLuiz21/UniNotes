/**
 * Server-side account recovery (there is intentionally no public recovery endpoint).
 * Requires shell access to the server. Resets the password, signs out every session and,
 * with --disable-mfa, removes MFA (for a lost authenticator without recovery codes).
 *
 *   docker compose run --rm -it backend node dist/scripts/reset-password.js --username alice [--disable-mfa]
 */
import { eq } from 'drizzle-orm';
import { users } from '../src/db/schema.js';
import { hashPassword, PASSWORD_MIN_LENGTH } from '../src/lib/password.js';
import { nowIso } from '../src/lib/time.js';
import { audit } from '../src/services/audit.service.js';
import { findUserByIdentifier } from '../src/services/users.service.js';
import { sessions, recoveryCodes } from '../src/db/schema.js';
import { arg, cliContext, fail, flag, prompt, readStdin } from './_cli.js';

const { db } = cliContext();
const identifier = arg('username') || (await prompt('Username or email: '));
const user = findUserByIdentifier(db, identifier);
if (!user) fail('No such user');

const password = flag('password-stdin')
  ? await readStdin()
  : await prompt('New password: ', { hidden: true });
if (!flag('password-stdin') && password !== (await prompt('Confirm password: ', { hidden: true })))
  fail('Passwords do not match');
if (password.length < PASSWORD_MIN_LENGTH)
  fail(`Password must be at least ${PASSWORD_MIN_LENGTH} characters`);

const now = nowIso();
const passwordHash = await hashPassword(password);
db.transaction((tx) => {
  tx.update(users)
    .set({ passwordHash, passwordChangedAt: now, updatedAt: now })
    .where(eq(users.id, user.id))
    .run();
  tx.delete(sessions).where(eq(sessions.userId, user.id)).run();
  if (flag('disable-mfa')) {
    tx.update(users)
      .set({ mfaSecretEnc: null, mfaPendingSecretEnc: null, mfaEnabledAt: null, mfaLastStep: null })
      .where(eq(users.id, user.id))
      .run();
    tx.delete(recoveryCodes).where(eq(recoveryCodes.userId, user.id)).run();
  }
});
audit(db, null, user.id, 'auth.password_changed', { via: 'cli', mfaDisabled: flag('disable-mfa') });
console.log(
  `Password reset for "${user.username}". All sessions were signed out.${flag('disable-mfa') ? ' MFA was disabled.' : ''}`,
);
db.$client.close();
