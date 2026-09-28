import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { before, after, test } from 'node:test';
import { Controller, Get } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { AuthService } from '../src/auth/auth.service.js';
import { createAuth } from '../src/auth/auth.factory.js';
import type { AuthEmail } from '../src/auth/auth.email.js';
import { DatabaseService } from '../src/database/database.service.js';
import * as schema from '../src/database/schema.js';
import { configureHttp } from '../src/http/configure-http.js';

@Controller('private-probe')
class PrivateProbe {
  @Get() read() {
    return { protected: true };
  }
}

const pg = new PGlite();
const db = drizzle(pg, { schema });
const origin = 'https://pointrush.test';
const config = {
  secret: randomBytes(32).toString('hex'),
  baseURL: 'https://api.pointrush.test',
  trustedOrigins: [origin],
  resendApiKey: 're_test_only',
  emailFrom: 'test@pointrush.test',
  emailEncryptionKey: randomBytes(32).toString('hex'),
};
const mailbox: AuthEmail[] = [];
const auth = createAuth(db, config, async (message) => {
  mailbox.push(message);
});
const service = new AuthService(auth, config.baseURL, config.trustedOrigins);
let app: NestExpressApplication;
let server: Parameters<typeof request>[0];
let cookie: string;
const email = 'http@example.test';
const password = 'An actual HTTP test password 123!';

before(async () => {
  await migrate(db, { migrationsFolder: resolve('migrations') });
  const module = await Test.createTestingModule({
    imports: [AppModule.forRoot(undefined, config)],
    controllers: [PrivateProbe],
  })
    .overrideProvider(DatabaseService)
    .useValue({ db, isReady: async () => true })
    .overrideProvider(AuthService)
    .useValue(service)
    .compile();
  app = module.createNestApplication<NestExpressApplication>({
    logger: false,
    bodyParser: false,
  });
  configureHttp(
    app,
    { nodeEnv: 'test', port: 8080, corsOrigins: [origin] },
    service.handler,
  );
  await app.init();
  server = app.getHttpServer() as Parameters<typeof request>[0];
});
after(async () => {
  await app?.close();
  await pg.close();
});

test('real HTTP signup, verification and login use the correct path and secure cookie', async () => {
  await request(server).get('/api/v1/private-probe').expect(401);
  await request(server).get('/api/v1/health/live').expect(200);
  await request(server)
    .post('/api/v1/auth/sign-up/email')
    .set('Origin', origin)
    .send({ email, password, name: 'HTTP User' })
    .expect(200);
  assert.equal(mailbox.length, 1);
  await request(server)
    .post('/api/v1/auth/sign-in/email')
    .set('Origin', origin)
    .send({ email, password })
    .expect(403);
  const url = new URL(mailbox[0]!.url);
  await request(server)
    .get(url.pathname + url.search)
    .expect(302);
  const signin = await request(server)
    .post('/api/v1/auth/sign-in/email')
    .set('X-Pointrush-Client-Ip', '203.0.113.99')
    .set('X-Forwarded-For', '203.0.113.99')
    .set('Origin', origin)
    .send({ email, password })
    .expect(200);
  const cookies: unknown = signin.headers['set-cookie'];
  assert.ok(Array.isArray(cookies));
  const header = cookies.find((value: string) =>
    value.includes('session_token'),
  ) as string | undefined;
  assert.ok(header);
  assert.match(header, /HttpOnly/i);
  assert.match(header, /Secure/i);
  cookie = header.split(';')[0]!;
  await request(server)
    .get('/api/v1/private-probe')
    .set('Cookie', cookie)
    .expect(200);
});

test('onboarding requires a trusted origin and a verified session; payload IDs cannot escalate privileges', async () => {
  const data = { username: 'http_user', displayName: 'HTTP User' };
  await request(server)
    .post('/api/v1/accounts/me')
    .set('Origin', origin)
    .send(data)
    .expect(401);
  await request(server)
    .post('/api/v1/accounts/me')
    .set('Cookie', cookie)
    .send(data)
    .expect(403);
  await request(server)
    .post('/api/v1/accounts/me')
    .set('Cookie', cookie)
    .set('Origin', 'https://evil.test')
    .send(data)
    .expect(403);
  await request(server)
    .post('/api/v1/accounts/me')
    .set('Cookie', cookie)
    .set('Origin', origin)
    .send({ ...data, authUserId: 'attacker', role: 'admin' })
    .expect(400);
  const first = await request(server)
    .post('/api/v1/accounts/me')
    .set('Cookie', cookie)
    .set('Origin', origin)
    .send(data)
    .expect(201);
  const retry = await request(server)
    .post('/api/v1/accounts/me')
    .set('Cookie', cookie)
    .set('Origin', origin)
    .send(data)
    .expect(201);
  assert.deepEqual(first.body, retry.body);
  await request(server)
    .post('/api/v1/accounts/me')
    .set('Cookie', cookie)
    .set('Origin', origin)
    .send({ ...data, username: 'different_name' })
    .expect(409);
  assert.equal((await db.select().from(schema.accounts)).length, 1);
  await db
    .update(schema.accounts)
    .set({ accessState: 'suspended' })
    .where(eq(schema.accounts.id, first.body.id));
  await request(server)
    .get('/api/v1/private-probe')
    .set('Cookie', cookie)
    .expect(403);
  await request(server)
    .post('/api/v1/accounts/me')
    .set('Cookie', cookie)
    .set('Origin', origin)
    .send(data)
    .expect(403);
});

test('actual auth routes reject oversized bodies and untrusted origins', async () => {
  const malformed = await request(server)
    .post('/api/v1/auth/sign-up/email')
    .set('Origin', origin)
    .set('Content-Type', 'application/json')
    .send('{"secret-fragment":')
    .expect(400);
  assert.ok(!JSON.stringify(malformed.body).includes('secret-fragment'));
  const oversized = await request(server)
    .post('/api/v1/auth/sign-up/email')
    .set('Origin', origin)
    .send({ email, password: 'x'.repeat(70000), name: 'Oversized' })
    .expect(413);
  assert.ok(!JSON.stringify(oversized.body).includes('xxxxx'));
  await request(server)
    .post('/api/v1/auth/sign-in/email')
    .set('Origin', 'https://evil.test')
    .send({ email, password })
    .expect(403);
});

test('spoofed forwarding headers cannot change the recorded session IP', async () => {
  const sessions = await db.select().from(schema.authSessions);
  assert.ok(sessions.length);
  assert.ok(
    sessions.every(
      (session) =>
        session.ipAddress === '127.0.0.1' ||
        session.ipAddress === '::ffff:127.0.0.1' ||
        session.ipAddress === '::1',
    ),
  );
  await request(server)
    .post('/api/v1/auth/sign-out')
    .set('Origin', origin)
    .set('Cookie', cookie)
    .send({})
    .expect(200);
  await request(server)
    .get('/api/v1/private-probe')
    .set('Cookie', cookie)
    .expect(401);
});
