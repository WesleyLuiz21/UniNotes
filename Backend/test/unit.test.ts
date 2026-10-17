import { describe, expect, it } from 'vitest';
import { SecretBox } from '../src/lib/crypto.js';
import { contentDisposition, exportAssetName, sanitizeOriginalName, slugify } from '../src/lib/filenames.js';
import { isValidDateOnly } from '../src/lib/time.js';
import { base32Decode, base32Encode, hotp, totp, verifyTotp } from '../src/lib/totp.js';
import { toFtsQuery } from '../src/services/search-index.js';
import { rewriteAssetLinks } from '../src/services/export.service.js';
import { excerpt } from '../src/services/notes.service.js';

describe('TOTP (RFC 6238 test vectors, SHA-1)', () => {
  const secret = base32Encode(Buffer.from('12345678901234567890'));
  it.each([
    [59, '94287082'],
    [1111111109, '07081804'],
    [1111111111, '14050471'],
    [1234567890, '89005924'],
    [2000000000, '69279037'],
  ])('t=%i -> %s', (t, expected) => {
    expect(hotp(base32Decode(secret), Math.floor(t / 30), 8)).toBe(expected);
  });

  it('verifies within ±1 step and rejects others', () => {
    const now = 1_700_000_000_000;
    const code = totp(secret, now);
    expect(verifyTotp(secret, code, now)).not.toBeNull();
    expect(verifyTotp(secret, code, now + 30_000)).not.toBeNull();
    expect(verifyTotp(secret, code, now + 90_000)).toBeNull();
    expect(verifyTotp(secret, 'abcdef', now)).toBeNull();
  });

  it('base32 round-trips', () => {
    const buf = Buffer.from('any random bytes!');
    expect(base32Decode(base32Encode(buf))).toEqual(buf);
  });
});

describe('SecretBox', () => {
  it('encrypts and authenticates', () => {
    const box = new SecretBox('k'.repeat(40));
    const sealed = box.seal('JBSWY3DPEHPK3PXP');
    expect(sealed).not.toContain('JBSWY3DPEHPK3PXP');
    expect(box.open(sealed)).toBe('JBSWY3DPEHPK3PXP');
    const tampered = sealed.slice(0, -2) + (sealed.endsWith('A') ? 'BB' : 'AA');
    expect(() => box.open(tampered)).toThrow();
    expect(() => new SecretBox('other'.repeat(10)).open(sealed)).toThrow();
  });
});

describe('filenames', () => {
  it('slugify produces safe names', () => {
    expect(slugify('Lecture 3: Graphs & Trees!')).toBe('lecture-3-graphs-trees');
    expect(slugify('../../etc/passwd')).toBe('etc-passwd');
    expect(slugify('...')).toBe('untitled');
    expect(slugify('Économie')).toBe('economie');
  });
  it('sanitizes original names and strips paths', () => {
    expect(sanitizeOriginalName('../../evil.png')).toBe('evil.png');
    expect(sanitizeOriginalName('C:\\Users\\x\\a<b>.pdf')).toBe('ab.pdf');
    expect(sanitizeOriginalName('.htaccess')).toBe('htaccess');
    expect(sanitizeOriginalName('')).toBe('file');
  });
  it('builds content-disposition with ascii fallback', () => {
    expect(contentDisposition('attachment', 'naïve "x".pdf')).toBe(
      `attachment; filename="na_ve _x_.pdf"; filename*=UTF-8''na%C3%AFve%20%22x%22.pdf`,
    );
  });
  it('export asset names are unique and safe', () => {
    expect(exportAssetName('0123abcd-0000-0000-0000-000000000000', '../My Diagram.PNG')).toBe(
      '0123abcd-my-diagram.png',
    );
  });
});

describe('date-only validation', () => {
  it('accepts real dates only', () => {
    expect(isValidDateOnly('2024-02-29')).toBe(true);
    expect(isValidDateOnly('2023-02-29')).toBe(false);
    expect(isValidDateOnly('2023-13-01')).toBe(false);
    expect(isValidDateOnly('2023-1-01')).toBe(false);
  });
});

describe('FTS query sanitisation', () => {
  it('quotes terms and neutralises FTS syntax', () => {
    expect(toFtsQuery('graph theory')).toBe('"graph"* "theory"*');
    expect(toFtsQuery('title: NEAR(a b) OR "x')).toBe('"title"* "near"* "a"* "b"* "or"* "x"*');
    expect(toFtsQuery('*** ()')).toBeNull();
  });
});

describe('export link rewriting', () => {
  it('rewrites known attachments and neutralises unknown ones', () => {
    const id = '11111111-2222-3333-4444-555555555555';
    const other = '99999999-2222-3333-4444-555555555555';
    const md = `![a](/api/attachments/${id}/content) [b](/api/attachments/${other}/content?download=1)`;
    const out = rewriteAssetLinks(md, new Map([[id, 'x.png']]), 'assets/');
    expect(out).toBe('![a](assets/x.png) [b](#attachment-not-exported)');
  });
});

describe('excerpt', () => {
  it('strips markdown syntax', () => {
    expect(excerpt('# Title\n\n**Bold** and [link](http://x) ![img](y)\n```js\ncode\n```')).toBe(
      'Title Bold and link',
    );
  });
});
