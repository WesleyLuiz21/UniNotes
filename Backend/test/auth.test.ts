import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import { sessions, users } from '../src/db/schema.js';
import { routeRegistry } from '../src/lib/route.js';
import { base32Decode, hotp, totpStep } from '../src/lib/totp.js';
import { sha256Hex } from '../src/lib/crypto.js';
import {
  Client,
  createTestEnv,
  loggedInClient,
  ORIGIN,
  PASSWORD,
  seedUser,
  type TestEnv,
} from './helpers.js';

let env: TestEnv;
beforeEach(() => {
  env = createTestEnv({ LOGIN_RATE_LIMIT: '5' });
});
afterEach(() => env.cleanup());

const codeAt = (secret: string, stepOffset = 0) => hotp(base32Decode(secret), totpStep() + stepOffset);

describe('login', () => {
  it('signs in with username or email and sets a hardened cookie', async () => {
    await seedUser(env);
    const c = new Client(env);
    const res = await c.login('student');
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('authenticated');
    expect(res.body.data.user.username).toBe('student');
    expect(res.body.data.user).not.toHaveProperty('passwordHash');
    const cookie = res.headers['set-cookie']![0]!;
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Lax/);
    expect(cookie).toMatch(/Path=\//);
    expect((await new Client(env).login('STUDENT@example.com')).status).toBe(200);
  });

  it('stores only a hash of the session token', async () => {
    await seedUser(env);
    const res = await new Client(env).login('student');
    const token = /uninotes_sid=([^;]+)/.exec(res.headers['set-cookie']![0]!)![1]!;
    const rows = env.ctx.db.select().from(sessions).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(sha256Hex(token));
    expect(rows[0]!.id).not.toBe(token);
  });

  it('returns the same generic error for unknown users and wrong passwords', async () => {
    await seedUser(env);
    const a = await new Client(env).login('student', 'wrong password!!');
    const b = await new Client(env).login('nobody', 'wrong password!!');
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(a.body).toEqual(b.body);
    expect(a.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('rate-limits repeated failures', async () => {
    await seedUser(env);
    const c = new Client(env);
    const statuses: number[] = [];
    for (let i = 0; i < 7; i++) statuses.push((await c.login('student', 'bad password ' + i)).status);
    expect(statuses.slice(0, 5)).toEqual([401, 401, 401, 401, 401]);
    expect(statuses.at(-1)).toBe(429);
    // Even the right password is refused while locked out.
    expect((await c.login('student')).status).toBe(429);
  });

  it('rotates the session on login (no fixation)', async () => {
    const c = await loggedInClient(env);
    const before = env.ctx.db
      .select()
      .from(sessions)
      .all()
      .map((s) => s.id);
    await c.agent
      .post('/api/auth/login')
      .set('Origin', ORIGIN)
      .set('X-CSRF-Token', c.csrf)
      .send({ identifier: 'student', password: PASSWORD });
    const after = env.ctx.db
      .select()
      .from(sessions)
      .all()
      .map((s) => s.id);
    expect(after).toHaveLength(1);
    expect(after[0]).not.toBe(before[0]);
  });
});

describe('protected endpoints', () => {
  it('every authenticated route rejects anonymous requests with 401', async () => {
    // Build the app so the registry is populated.
    const routes = routeRegistry.filter((r) => r.auth);
    expect(routes.length).toBeGreaterThan(30);
    const uuid = '00000000-0000-4000-8000-000000000000';
    for (const r of routes) {
      const url = r.path.replace(/:sessionId/g, 'a'.repeat(64)).replace(/:\w+/g, uuid);
      const res = await request(env.app)[r.method as 'get'](url).set('Origin', ORIGIN).send({});
      expect(res.status, `${r.method.toUpperCase()} ${r.path}`).toBe(401);
    }
  });

  it('health is public but reveals nothing sensitive', async () => {
    const res = await request(env.app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: { status: 'ok', database: 'ok' } });
  });

  it('sets security headers and no-store', async () => {
    const res = await request(env.app).get('/api/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toContain("default-src 'none'");
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('does not leak stack traces for malformed JSON', async () => {
    const res = await request(env.app)
      .post('/api/auth/login')
      .set('Origin', ORIGIN)
      .set('Content-Type', 'application/json')
      .send('{bad');
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).not.toMatch(/at |node_modules|\/src\//);
  });
});

describe('CSRF', () => {
  it('rejects state changes without the CSRF token', async () => {
    const c = await loggedInClient(env);
    const res = await c.agent.post('/api/modules').set('Origin', ORIGIN).send({ name: 'X' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CSRF_TOKEN_INVALID');
  });

  it('rejects a wrong CSRF token', async () => {
    const c = await loggedInClient(env);
    const res = await c.agent
      .post('/api/modules')
      .set('Origin', ORIGIN)
      .set('X-CSRF-Token', 'nope')
      .send({ name: 'X' });
    expect(res.status).toBe(403);
  });

  it('rejects cross-origin requests even with a valid token', async () => {
    const c = await loggedInClient(env);
    const res = await c.agent
      .post('/api/modules')
      .set('Origin', 'https://evil.example')
      .set('X-CSRF-Token', c.csrf)
      .send({ name: 'X' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CSRF_ORIGIN_MISMATCH');
    const res2 = await c.agent
      .post('/api/modules')
      .set('Sec-Fetch-Site', 'cross-site')
      .set('X-CSRF-Token', c.csrf)
      .send({ name: 'X' });
    expect(res2.status).toBe(403);
  });

  it('accepts same-origin requests with the token', async () => {
    const c = await loggedInClient(env);
    expect((await c.post('/api/modules', { name: 'X' })).status).toBe(201);
  });
});

describe('sessions', () => {
  it('expires idle sessions', async () => {
    const c = await loggedInClient(env);
    expect((await c.get('/api/notes')).status).toBe(200);
    env.ctx.db
      .update(sessions)
      .set({ expiresAt: new Date(Date.now() - 1000).toISOString() })
      .run();
    expect((await c.get('/api/notes')).status).toBe(401);
    expect(env.ctx.db.select().from(sessions).all()).toHaveLength(0);
  });

  it('enforces the absolute lifetime', async () => {
    const c = await loggedInClient(env);
    env.ctx.db
      .update(sessions)
      .set({ absoluteExpiresAt: new Date(Date.now() - 1000).toISOString() })
      .run();
    expect((await c.get('/api/notes')).status).toBe(401);
  });

  it('logout revokes the session server-side', async () => {
    const c = await loggedInClient(env);
    const cookie = (await c.get('/api/auth/session')).request.cookies;
    expect((await c.post('/api/auth/logout')).status).toBe(204);
    expect((await c.get('/api/notes')).status).toBe(401);
    // Replaying the old cookie does not work either.
    const replay = await request(env.app)
      .get('/api/notes')
      .set('Cookie', cookie as unknown as string);
    expect(replay.status).toBe(401);
  });

  it('logout-all revokes every session', async () => {
    const a = await loggedInClient(env);
    const b = new Client(env);
    await b.login('student');
    expect((await a.post('/api/auth/logout-all')).status).toBe(204);
    expect((await a.get('/api/notes')).status).toBe(401);
    expect((await b.get('/api/notes')).status).toBe(401);
  });

  it('lists and revokes other sessions', async () => {
    const a = await loggedInClient(env);
    const b = new Client(env);
    await b.login('student');
    const sec = await a.get('/api/settings/security');
    expect(sec.body.data.sessions).toHaveLength(2);
    const other = sec.body.data.sessions.find((s: { current: boolean }) => !s.current);
    expect((await a.delete(`/api/settings/security/sessions/${other.id}`)).status).toBe(204);
    expect((await b.get('/api/notes')).status).toBe(401);
    expect((await a.get('/api/notes')).status).toBe(200);
  });

  it('password change requires the current password and signs out other sessions', async () => {
    const a = await loggedInClient(env);
    const b = new Client(env);
    await b.login('student');
    const bad = await a.post('/api/settings/security/password', {
      currentPassword: 'wrong',
      newPassword: 'a brand new password 42',
    });
    expect(bad.status).toBe(400);
    const ok = await a.post('/api/settings/security/password', {
      currentPassword: PASSWORD,
      newPassword: 'a brand new password 42',
    });
    expect(ok.status).toBe(200);
    a.csrf = ok.body.data.csrfToken;
    expect((await a.get('/api/notes')).status).toBe(200);
    expect((await b.get('/api/notes')).status).toBe(401);
    expect((await new Client(env).login('student', 'a brand new password 42')).status).toBe(200);
  });
});

describe('MFA (TOTP)', () => {
  async function enableMfa(c: Client) {
    const setup = await c.post('/api/settings/security/mfa/setup', { currentPassword: PASSWORD });
    expect(setup.status).toBe(200);
    expect(setup.body.data.qrSvg).toContain('<svg');
    const secret = setup.body.data.secret as string;
    const enable = await c.post('/api/settings/security/mfa/enable', { code: codeAt(secret) });
    expect(enable.status).toBe(200);
    return { secret, recoveryCodes: enable.body.data.recoveryCodes as string[] };
  }

  it('requires re-authentication to start enrolment', async () => {
    const c = await loggedInClient(env);
    expect((await c.post('/api/settings/security/mfa/setup', { currentPassword: 'nope' })).status).toBe(400);
  });

  it('stores the TOTP secret encrypted and recovery codes hashed', async () => {
    const c = await loggedInClient(env);
    const { secret, recoveryCodes } = await enableMfa(c);
    expect(recoveryCodes).toHaveLength(10);
    const raw = env.ctx.db.$client.prepare('SELECT * FROM users').get() as Record<string, unknown>;
    expect(JSON.stringify(raw)).not.toContain(secret);
    const codes = env.ctx.db.$client.prepare('SELECT code_hash FROM recovery_codes').all() as {
      code_hash: string;
    }[];
    for (const rc of recoveryCodes) expect(JSON.stringify(codes)).not.toContain(rc);
  });

  it('login requires a second factor and rejects replayed codes', async () => {
    const c = await loggedInClient(env);
    const { secret } = await enableMfa(c);
    const d = new Client(env);
    const step1 = await d.login('student');
    expect(step1.body.data.status).toBe('mfa_required');
    expect(step1.body.data.user).toBeNull();
    // Pending session cannot access data.
    expect((await d.get('/api/notes')).status).toBe(401);
    expect((await d.post('/api/auth/login/mfa', { code: '000000' })).status).toBe(401);
    // The code used during enrolment was consumed; the next step's code works once.
    const code = codeAt(secret, 1);
    const ok = await d.post('/api/auth/login/mfa', { code });
    expect(ok.status).toBe(200);
    d.csrf = ok.body.data.csrfToken;
    expect((await d.get('/api/notes')).status).toBe(200);

    const e = new Client(env);
    await e.login('student');
    expect((await e.post('/api/auth/login/mfa', { code })).status).toBe(401);
  });

  it('recovery codes are single-use', async () => {
    const c = await loggedInClient(env);
    const { recoveryCodes } = await enableMfa(c);
    const d = new Client(env);
    await d.login('student');
    expect((await d.post('/api/auth/login/mfa', { code: recoveryCodes[0] })).status).toBe(200);
    const e = new Client(env);
    await e.login('student');
    expect((await e.post('/api/auth/login/mfa', { code: recoveryCodes[0] })).status).toBe(401);
  });

  it('disabling MFA requires password and a valid code', async () => {
    const c = await loggedInClient(env);
    const { recoveryCodes } = await enableMfa(c);
    expect(
      (await c.post('/api/settings/security/mfa/disable', { currentPassword: PASSWORD, code: '123456' }))
        .status,
    ).toBe(400);
    expect(
      (
        await c.post('/api/settings/security/mfa/disable', {
          currentPassword: PASSWORD,
          code: recoveryCodes[1],
        })
      ).status,
    ).toBe(204);
    const user = env.ctx.db.select().from(users).where(eq(users.username, 'student')).get()!;
    expect(user.mfaEnabledAt).toBeNull();
    expect(user.mfaSecretEnc).toBeNull();
  });

  it('mfa-pending sessions expire quickly', async () => {
    const c = await loggedInClient(env);
    await enableMfa(c);
    const d = new Client(env);
    await d.login('student');
    const pending = env.ctx.db.select().from(sessions).where(eq(sessions.state, 'mfa_pending')).get()!;
    expect(Date.parse(pending.absoluteExpiresAt) - Date.now()).toBeLessThanOrEqual(10 * 60_000);
  });
});
