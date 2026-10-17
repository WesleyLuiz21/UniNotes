import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import type TestAgent from 'supertest/lib/agent.js';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { createContext, type AppContext } from '../src/context.js';
import { openDatabase } from '../src/db/client.js';
import { runMigrations } from '../src/db/migrations.js';
import { createLogger } from '../src/logger.js';
import { createUser } from '../src/services/users.service.js';

export const ORIGIN = 'http://uninotes.test';
export const PASSWORD = 'correct horse battery staple';

export function createTestEnv(env: Record<string, string> = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uninotes-test-'));
  const config = loadConfig({
    NODE_ENV: 'test',
    DATA_DIR: dir,
    APP_SECRET_KEY: 'test-secret-key-that-is-long-enough-123456',
    APP_ORIGIN: ORIGIN,
    LOG_LEVEL: 'silent',
    ...env,
  } as NodeJS.ProcessEnv);
  const db = openDatabase(config.paths.database);
  runMigrations(db);
  fs.mkdirSync(config.paths.attachments, { recursive: true });
  const ctx: AppContext = createContext(config, db, createLogger('silent'));
  const app = createApp(ctx);
  return {
    ctx,
    app,
    dir,
    cleanup: () => {
      db.$client.close();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

export type TestEnv = ReturnType<typeof createTestEnv>;

/** A logged-in browser-like client: keeps cookies, sends Origin and the CSRF header. */
export class Client {
  agent: TestAgent;
  csrf = '';

  constructor(readonly env: TestEnv) {
    this.agent = request.agent(env.app);
  }

  async login(identifier: string, password = PASSWORD) {
    const res = await this.agent.post('/api/auth/login').set('Origin', ORIGIN).send({ identifier, password });
    if (res.body?.data?.csrfToken) this.csrf = res.body.data.csrfToken;
    return res;
  }

  get(url: string) {
    return this.agent.get(url);
  }
  post(url: string, body?: object) {
    return this.agent
      .post(url)
      .set('Origin', ORIGIN)
      .set('X-CSRF-Token', this.csrf)
      .send(body ?? {});
  }
  patch(url: string, body: object) {
    return this.agent.patch(url).set('Origin', ORIGIN).set('X-CSRF-Token', this.csrf).send(body);
  }
  delete(url: string, body?: object) {
    const r = this.agent.delete(url).set('Origin', ORIGIN).set('X-CSRF-Token', this.csrf);
    return body ? r.send(body) : r;
  }
  upload(url: string, fields: Record<string, string>, file: { buffer: Buffer; name: string }) {
    let r = this.agent.post(url).set('Origin', ORIGIN).set('X-CSRF-Token', this.csrf);
    for (const [k, v] of Object.entries(fields)) r = r.field(k, v);
    return r.attach('file', file.buffer, file.name);
  }
}

export async function seedUser(env: TestEnv, username = 'student', password = PASSWORD) {
  return createUser(env.ctx.db, {
    username,
    email: `${username}@example.com`,
    displayName: username,
    password,
  });
}

export async function loggedInClient(env: TestEnv, username = 'student') {
  await seedUser(env, username);
  const c = new Client(env);
  const res = await c.login(username);
  if (res.status !== 200) throw new Error(`login failed: ${res.status} ${JSON.stringify(res.body)}`);
  return c;
}

export async function createModule(c: Client, body: object = {}) {
  const res = await c.post('/api/modules', {
    name: 'Algorithms',
    code: 'CS201',
    academicYear: '2025/26',
    ...body,
  });
  return res.body.data as { id: string; name: string };
}

export async function createNote(c: Client, body: object = {}) {
  const res = await c.post('/api/notes', {
    title: 'Note',
    markdownContent: 'Hello',
    lectureDate: '2025-10-01',
    ...body,
  });
  if (res.status !== 201) throw new Error(`create note failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.data as { id: string; revision: number; title: string; markdownContent: string };
}
