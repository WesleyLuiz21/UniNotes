import { hash, verify } from '@node-rs/argon2';

// Argon2id (algorithm 2). 64 MiB memory, 3 iterations, 1 lane exceeds OWASP's minimum
// recommendation (19 MiB, t=2) while staying ~100-200 ms on a small VPS.
const OPTIONS = { algorithm: 2, memoryCost: 65536, timeCost: 3, parallelism: 1, outputLen: 32 } as const;

export const hashPassword = (password: string) => hash(password, OPTIONS);

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

// A valid hash used to equalise timing when a login identifier does not exist.
let dummyHash: Promise<string> | undefined;
export async function burnPasswordCheck(password: string) {
  dummyHash ??= hashPassword('uninotes-timing-equaliser');
  await verifyPassword(await dummyHash, password);
}

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 256;
