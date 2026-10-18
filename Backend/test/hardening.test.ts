import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import { auditEvents } from '../src/db/schema.js';
import { burnPasswordCheck } from '../src/lib/password.js';
import { inferTitle } from '../src/services/import.service.js';
import { pruneAuditEvents } from '../src/services/audit.service.js';
import {
  Client,
  createTestEnv,
  loggedInClient,
  ORIGIN,
  PASSWORD,
  seedUser,
  type TestEnv,
} from './helpers.js';
import { PNG_1x1 } from './fixtures.js';

let env: TestEnv;
beforeEach(() => {
  // Production-like proxy setting: exactly one trusted hop (the edge Caddy).
  env = createTestEnv({ TRUST_PROXY: '1', LOGIN_RATE_LIMIT: '5' });
});
afterEach(() => env.cleanup());

const loginFrom = (ip: string, password: string, identifier = 'student') =>
  request(env.app)
    .post('/api/auth/login')
    .set('Origin', ORIGIN)
    .set('X-Forwarded-For', ip)
    .send({ identifier, password });

describe('client IP handling', () => {
  it('uses the address set by the trusted proxy, ignoring spoofed entries further left', async () => {
    await seedUser(env);
    await request(env.app)
      .post('/api/auth/login')
      .set('Origin', ORIGIN)
      .set('X-Forwarded-For', '6.6.6.6, 203.0.113.9')
      .send({ identifier: 'student', password: 'wrong password!' });
    const ev = env.ctx.db.select().from(auditEvents).where(eq(auditEvents.type, 'auth.login.failure')).get();
    expect(ev?.ip).toBe('203.0.113.9');
  });
});

describe('login throttling cannot be used to lock the owner out', () => {
  it('blocks a guessing source but still lets the owner in from elsewhere', async () => {
    await seedUser(env);
    const attacker = '198.51.100.66';
    for (let i = 0; i < 5; i++) expect((await loginFrom(attacker, `guess ${i} wrong`)).status).toBe(401);
    expect((await loginFrom(attacker, 'guess again wrong')).status).toBe(429);
    // The attacker is blocked even with the right password…
    expect((await loginFrom(attacker, PASSWORD)).status).toBe(429);
    // …but the owner, from their own IP, is not locked out.
    expect((await loginFrom('192.0.2.10', PASSWORD)).status).toBe(200);
  });

  it('distributed failures slow the account down but never block it', async () => {
    await seedUser(env);
    for (let i = 0; i < 22; i++) await loginFrom(`203.0.113.${i + 1}`, 'wrong password!!');
    const t = Date.now();
    const res = await loginFrom('192.0.2.77', PASSWORD);
    expect(res.status).toBe(200);
    expect(Date.now() - t).toBeGreaterThanOrEqual(400); // account-wide delay applied
  });
});

describe('anonymous resource limits', () => {
  it('rejects anonymous uploads before parsing the multipart body', async () => {
    const res = await request(env.app)
      .post('/api/attachments')
      .set('Origin', ORIGIN)
      .field('noteId', '00000000-0000-4000-8000-000000000000')
      .attach('file', Buffer.concat([PNG_1x1, Buffer.alloc(2 * 1024 * 1024)]), 'a.png');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('limits anonymous JSON bodies to 16 KB', async () => {
    const res = await request(env.app)
      .post('/api/auth/login')
      .set('Origin', ORIGIN)
      .send({ identifier: 'x', password: 'y', pad: 'z'.repeat(20_000) });
    expect(res.status).toBe(413);
  });

  it('signed-in users keep the normal body limit', async () => {
    const c = await loggedInClient(env);
    const res = await c.post('/api/notes', {
      lectureDate: '2025-01-01',
      markdownContent: 'x'.repeat(100_000),
    });
    expect(res.status).toBe(201);
  });

  it('bounds concurrent Argon2 work and sheds excess load with 503', async () => {
    const results = await Promise.allSettled(Array.from({ length: 30 }, () => burnPasswordCheck('x')));
    const rejected = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    expect(rejected.length).toBeGreaterThan(0);
    expect((rejected[0]!.reason as { status: number }).status).toBe(503);
    expect(results.filter((r) => r.status === 'fulfilled').length).toBeGreaterThanOrEqual(18);
  });
});

describe('MFA guessing cap', () => {
  it('discards the pending sign-in after 5 wrong codes', async () => {
    const c = await loggedInClient(env);
    const setup = await c.post('/api/settings/security/mfa/setup', { currentPassword: PASSWORD });
    const { hotp, base32Decode, totpStep } = await import('../src/lib/totp.js');
    await c.post('/api/settings/security/mfa/enable', {
      code: hotp(base32Decode(setup.body.data.secret), totpStep()),
    });
    const d = new Client(env);
    await d.login('student');
    for (let i = 0; i < 4; i++)
      expect((await d.post('/api/auth/login/mfa', { code: '000000' })).body.error.code).toBe(
        'INVALID_MFA_CODE',
      );
    const last = await d.post('/api/auth/login/mfa', { code: '000000' });
    expect(last.body.error.code).toBe('MFA_ATTEMPTS_EXCEEDED');
    // The pending session is gone: further guesses are not even evaluated.
    expect((await d.post('/api/auth/login/mfa', { code: '000000' })).status).toBe(401);
    expect((await d.get('/api/auth/session')).body.data.status).toBe('anonymous');
  });
});

describe('misc hardening', () => {
  it('import title detection is linear-time on hostile input', () => {
    const hostile = `# x${' '.repeat(200_000)}y`;
    const t = Date.now();
    const title = inferTitle(hostile, 'a.md');
    expect(title.startsWith('x')).toBe(true);
    expect(title.length).toBeLessThanOrEqual(300);
    expect(Date.now() - t).toBeLessThan(200);
    expect(inferTitle('intro\n# Title ##\n', 'a.md')).toBe('Title');
    expect(inferTitle('no heading', 'my_notes.md')).toBe('my notes');
  });

  it('logout tells the browser to clear cached private content', async () => {
    const c = await loggedInClient(env);
    const res = await c.post('/api/auth/logout');
    expect(res.headers['clear-site-data']).toBe('"cache"');
  });

  it('attachments are revalidated rather than cached', async () => {
    const c = await loggedInClient(env);
    const note = (await c.post('/api/notes', { lectureDate: '2025-01-01' })).body.data;
    const up = await c.upload('/api/attachments', { noteId: note.id }, { buffer: PNG_1x1, name: 'a.png' });
    const res = await c.get(up.body.data.url);
    expect(res.headers['cache-control']).toBe('private, no-cache');
    const again = await c.agent.get(up.body.data.url).set('If-None-Match', res.headers.etag!);
    expect(again.status).toBe(304);
  });

  it('prunes old audit events', async () => {
    await seedUser(env);
    await loginFrom('192.0.2.1', 'wrong password!!');
    const future = Date.now() + 91 * 86_400_000;
    expect(pruneAuditEvents(env.ctx.db, future)).toBe(1);
  });
});
