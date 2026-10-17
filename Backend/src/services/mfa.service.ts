import crypto from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import QRCode from 'qrcode';
import type { AppContext } from '../context.js';
import { recoveryCodes, users, type User } from '../db/schema.js';
import { newId } from '../lib/crypto.js';
import { badRequest } from '../lib/errors.js';
import { verifyPassword } from '../lib/password.js';
import { nowIso } from '../lib/time.js';
import { generateTotpSecret, otpauthUri, verifyTotp } from '../lib/totp.js';

const RECOVERY_CODE_COUNT = 10;

/** Recovery codes are high-entropy, so a keyed HMAC is a suitable (and fast) one-way hash. */
function hashRecoveryCode(ctx: AppContext, code: string) {
  const key = crypto.hkdfSync('sha256', ctx.config.secretKey, 'uninotes', 'recovery-codes-v1', 32);
  return crypto.createHmac('sha256', Buffer.from(key)).update(normaliseRecoveryCode(code)).digest('hex');
}

const normaliseRecoveryCode = (code: string) =>
  code
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

function generateRecoveryCode() {
  const raw = crypto.randomBytes(8).toString('hex').slice(0, 10); // 40 bits
  return `${raw.slice(0, 5)}-${raw.slice(5)}`;
}

export function replaceRecoveryCodes(ctx: AppContext, userId: string): string[] {
  const codes = Array.from({ length: RECOVERY_CODE_COUNT }, generateRecoveryCode);
  const now = nowIso();
  ctx.db.transaction((tx) => {
    tx.delete(recoveryCodes).where(eq(recoveryCodes.userId, userId)).run();
    tx.insert(recoveryCodes)
      .values(codes.map((c) => ({ id: newId(), userId, codeHash: hashRecoveryCode(ctx, c), createdAt: now })))
      .run();
  });
  return codes;
}

export function remainingRecoveryCodes(ctx: AppContext, userId: string) {
  return ctx.db
    .select({ id: recoveryCodes.id })
    .from(recoveryCodes)
    .where(and(eq(recoveryCodes.userId, userId), isNull(recoveryCodes.usedAt)))
    .all().length;
}

/** Begin enrolment: store an encrypted pending secret and return what the authenticator needs. */
export async function beginMfaSetup(ctx: AppContext, user: User) {
  const secret = generateTotpSecret();
  ctx.db
    .update(users)
    .set({ mfaPendingSecretEnc: ctx.secretBox.seal(secret), updatedAt: nowIso() })
    .where(eq(users.id, user.id))
    .run();
  const uri = otpauthUri(secret, user.email ?? user.username);
  const qrSvg = await QRCode.toString(uri, { type: 'svg', errorCorrectionLevel: 'M', margin: 1 });
  return { secret, otpauthUri: uri, qrSvg };
}

export function confirmMfaSetup(ctx: AppContext, user: User, code: string): string[] {
  if (!user.mfaPendingSecretEnc) throw badRequest('Start MFA setup first');
  const secret = ctx.secretBox.open(user.mfaPendingSecretEnc);
  const step = verifyTotp(secret, code);
  if (step === null) throw badRequest('That code is not valid. Check your authenticator app and try again.');
  ctx.db
    .update(users)
    .set({
      mfaSecretEnc: user.mfaPendingSecretEnc,
      mfaPendingSecretEnc: null,
      mfaEnabledAt: nowIso(),
      mfaLastStep: step,
      updatedAt: nowIso(),
    })
    .where(eq(users.id, user.id))
    .run();
  return replaceRecoveryCodes(ctx, user.id);
}

export function disableMfa(ctx: AppContext, userId: string) {
  ctx.db.transaction((tx) => {
    tx.update(users)
      .set({
        mfaSecretEnc: null,
        mfaPendingSecretEnc: null,
        mfaEnabledAt: null,
        mfaLastStep: null,
        updatedAt: nowIso(),
      })
      .where(eq(users.id, userId))
      .run();
    tx.delete(recoveryCodes).where(eq(recoveryCodes.userId, userId)).run();
  });
}

export type SecondFactorResult = 'totp' | 'recovery' | null;

/**
 * Verify a TOTP code (with replay protection) or a single-use recovery code.
 * Successful use is persisted atomically.
 */
export function verifySecondFactor(ctx: AppContext, user: User, code: string): SecondFactorResult {
  if (!user.mfaSecretEnc) return null;
  const trimmed = code.trim().replace(/\s+/g, '');
  if (/^\d{6}$/.test(trimmed)) {
    const step = verifyTotp(ctx.secretBox.open(user.mfaSecretEnc), trimmed);
    if (step === null) return null;
    // Atomic compare-and-set so the same code cannot be used twice (even concurrently).
    const res = ctx.db.$client
      .prepare(
        'UPDATE users SET mfa_last_step = ? WHERE id = ? AND (mfa_last_step IS NULL OR mfa_last_step < ?)',
      )
      .run(step, user.id, step);
    return res.changes === 1 ? 'totp' : null;
  }
  const hash = hashRecoveryCode(ctx, trimmed);
  const res = ctx.db
    .update(recoveryCodes)
    .set({ usedAt: nowIso() })
    .where(
      and(eq(recoveryCodes.userId, user.id), eq(recoveryCodes.codeHash, hash), isNull(recoveryCodes.usedAt)),
    )
    .run();
  return res.changes === 1 ? 'recovery' : null;
}

/**
 * Re-authentication for sensitive changes: current password, plus a second factor when MFA is on.
 */
export async function reauthenticate(ctx: AppContext, user: User, password: string, code?: string) {
  const okPassword = await verifyPassword(user.passwordHash, password);
  if (!okPassword)
    throw badRequest('Current password is incorrect', [
      { path: 'currentPassword', message: 'Incorrect password' },
    ]);
  if (user.mfaEnabledAt) {
    if (!code || !verifySecondFactor(ctx, user, code)) {
      throw badRequest('A valid authentication code is required', [
        { path: 'code', message: 'Invalid code' },
      ]);
    }
  }
}
