import { hash, verify } from '@node-rs/argon2';
import { ApiError } from './errors.js';

// Argon2id (algorithm 2). 64 MiB memory, 3 iterations, 1 lane exceeds OWASP's minimum
// recommendation (19 MiB, t=2) while staying ~100-200 ms on a small VPS.
const OPTIONS = { algorithm: 2, memoryCost: 65536, timeCost: 3, parallelism: 1, outputLen: 32 } as const;

/*
 * Each Argon2 computation allocates 64 MiB. Unbounded concurrency lets anonymous login floods
 * exhaust memory (and get the container OOM-killed), so hashing is admitted through a small
 * semaphore with a bounded queue. Excess requests fail fast with 503 instead of piling up.
 */
const MAX_CONCURRENT = 2;
const MAX_QUEUED = 16;
let active = 0;
const queue: (() => void)[] = [];

async function withHashSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= MAX_CONCURRENT) {
    if (queue.length >= MAX_QUEUED) {
      throw new ApiError(503, 'SERVER_BUSY', 'The server is busy. Please try again in a moment.');
    }
    await new Promise<void>((resolve) => queue.push(resolve));
  }
  active++;
  try {
    return await fn();
  } finally {
    active--;
    queue.shift()?.();
  }
}

export const hashPassword = (password: string) => withHashSlot(() => hash(password, OPTIONS));

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  return withHashSlot(async () => {
    try {
      return await verify(passwordHash, password);
    } catch {
      return false;
    }
  });
}

// A valid hash used to equalise timing when a login identifier does not exist.
let dummyHash: Promise<string> | undefined;
export async function burnPasswordCheck(password: string) {
  dummyHash ??= hashPassword('uninotes-timing-equaliser');
  await verifyPassword(await dummyHash, password);
}

/** Test/diagnostic hook. */
export const hashQueueState = () => ({ active, queued: queue.length });

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 256;
