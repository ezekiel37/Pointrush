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

test('verified users without a linked account receive onboarding status without creating data', async () => {
  const result = await request(server)
    .get('/api/v1/accounts/me')
    .set('Cookie', cookie)
    .expect(200);
  assert.deepEqual(result.body, { onboarding: 'required', account: null });
  assert.equal(result.headers['cache-control'], 'no-store');
  assert.equal((await db.select().from(schema.accounts)).length, 0);
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

test('own account status stays readable across access states without authorizing business routes', async () => {
  const [account] = await db.select().from(schema.accounts);
  assert.ok(account);
  for (const accessState of ['active', 'restricted', 'suspended', 'closed']) {
    await db
      .update(schema.accounts)
      .set({ accessState })
      .where(eq(schema.accounts.id, account.id));
    const result = await request(server)
      .get('/api/v1/accounts/me')
      .set('Cookie', cookie)
      .expect(200);
    assert.equal(result.headers['cache-control'], 'no-store');
    assert.deepEqual(result.body, {
      onboarding: 'complete',
      account: {
        id: account.id,
        accessState,
        username: 'http_user',
        displayName: 'HTTP User',
      },
    });
    await request(server)
      .get('/api/v1/private-probe')
      .set('Cookie', cookie)
      .expect(accessState === 'active' ? 200 : 403);
    if (accessState !== 'active') {
      await request(server)
        .post('/api/v1/accounts/me')
        .set('Cookie', cookie)
        .set('Origin', origin)
        .send({ username: 'http_user', displayName: 'HTTP User' })
        .expect(403);
    }
  }
});

test('a second authenticated user cannot read the first user account by supplying its identifier', async () => {
  const otherEmail = 'other-http@example.test';
  await request(server)
    .post('/api/v1/auth/sign-up/email')
    .set('Origin', origin)
    .send({ email: otherEmail, password, name: 'Other User' })
    .expect(200);
  const message = mailbox.find((item) => item.to === otherEmail);
  assert.ok(message);
  const url = new URL(message.url);
  await request(server)
    .get(url.pathname + url.search)
    .expect(302);
  const login = await request(server)
    .post('/api/v1/auth/sign-in/email')
    .set('Origin', origin)
    .send({ email: otherEmail, password })
    .expect(200);
  const cookies = login.headers['set-cookie'] as unknown as string[];
  const otherCookie = cookies
    .find((item) => item.includes('session_token'))
    ?.split(';')[0];
  assert.ok(otherCookie);
  const [victim] = await db.select().from(schema.accounts);
  assert.ok(victim);
  const result = await request(server)
    .get(`/api/v1/accounts/me?accountId=${victim.id}`)
    .set('Cookie', otherCookie)
    .expect(200);
  assert.deepEqual(result.body, { onboarding: 'required', account: null });
});

test('account status uses only the session identity and fails closed on incomplete profiles', async () => {
  const [user] = await db
    .select()
    .from(schema.authUsers)
    .where(eq(schema.authUsers.email, email));
  const [link] = await db
    .select()
    .from(schema.authAccountLinks)
    .where(eq(schema.authAccountLinks.authUserId, user!.id));
  assert.ok(link);
  await request(server).get('/api/v1/accounts/me').expect(401);
  await request(server)
    .get('/api/v1/accounts/me')
    .set('Cookie', 'session_token=forged')
    .expect(401);
  const spoofed = await request(server)
    .get('/api/v1/accounts/me?authUserId=someone-else&accountId=someone-else')
    .set('Cookie', cookie)
    .set('X-Auth-User-Id', 'someone-else')
    .expect(200);
  assert.equal(spoofed.body.account.id, link.accountId);
  await db
    .update(schema.authUsers)
    .set({ emailVerified: false })
    .where(eq(schema.authUsers.id, user!.id));
  await request(server)
    .get('/api/v1/accounts/me')
    .set('Cookie', cookie)
    .expect(403);
  await db
    .update(schema.authUsers)
    .set({ emailVerified: true })
    .where(eq(schema.authUsers.id, user!.id));
  await db
    .delete(schema.accountProfiles)
    .where(eq(schema.accountProfiles.accountId, link.accountId));
  const broken = await request(server)
    .get('/api/v1/accounts/me')
    .set('Cookie', cookie)
    .expect(500);
  assert.equal(broken.body.message, 'Internal server error');
  assert.ok(!JSON.stringify(broken.body).includes('identity is incomplete'));
  await db
    .insert(schema.accountProfiles)
    .values({ accountId: link.accountId, displayName: 'HTTP User' });
});

test('actual auth routes reject oversized bodies and untrusted origins', async () => {
  // Isolate origin/body checks from earlier users sharing the test loopback IP.
  await db.delete(schema.authRateLimits);
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
  await request(server)
    .get('/api/v1/accounts/me')
    .set('Cookie', cookie)
    .expect(401);
});
