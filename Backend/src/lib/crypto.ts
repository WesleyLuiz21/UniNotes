import crypto from 'node:crypto';

export const newId = () => crypto.randomUUID();

/** URL-safe random token with `bytes` bytes of entropy. */
export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');

export const sha256Hex = (input: string | Buffer) => crypto.createHash('sha256').update(input).digest('hex');

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

/**
 * AES-256-GCM encryption for small secrets at rest (e.g. TOTP secrets).
 * The key is derived from APP_SECRET_KEY with HKDF so the raw env value is never used directly.
 * Format: v1.<iv>.<tag>.<ciphertext> (base64url parts).
 */
export class SecretBox {
  private readonly key: Buffer;

  constructor(secret: string) {
    this.key = Buffer.from(crypto.hkdfSync('sha256', secret, 'uninotes', 'secretbox-v1', 32));
  }

  seal(plaintext: string): string {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.key, iv);
    const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return ['v1', iv, cipher.getAuthTag(), ct]
      .map((p) => (typeof p === 'string' ? p : p.toString('base64url')))
      .join('.');
  }

  open(sealed: string): string {
    const [version, iv, tag, ct] = sealed.split('.');
    if (version !== 'v1' || !iv || !tag || ct === undefined) throw new Error('Malformed sealed value');
    const decipher = crypto.createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(ct, 'base64url')), decipher.final()]).toString('utf8');
  }
}
