import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
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
import { postFundingTransfer } from '../src/funding/funding-ledger.js';
import { TaskWorkModule } from '../src/tasks/task-work.module.js';
import { ReviewsModule } from '../src/reviews/reviews.module.js';
import { CampaignsModule } from '../src/campaigns/campaigns.module.js';
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
    imports: [
      AppModule.forRoot(undefined, config, 'test-v1'),
      ReviewsModule,
      TaskWorkModule,
      CampaignsModule,
    ],
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
    .set('CF-Connecting-IP', '203.0.113.98')
    .set('True-Client-IP', '203.0.113.97')
    .set('X-Real-IP', '203.0.113.96')
    .set('Forwarded', 'for=203.0.113.95;proto=https')
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

test('sponsor routes require session and trusted origin, derive ownership, and reject unfunded tasks', async () => {
  // The preceding account-state test deliberately leaves this account closed.
  const [ownerLink] = await db.select().from(schema.authAccountLinks);
  await request(server)
    .get('/api/v1/sponsor/profile')
    .set('Cookie', cookie)
    .expect(403);
  await db
    .update(schema.accounts)
    .set({ accessState: 'active' })
    .where(eq(schema.accounts.id, ownerLink!.accountId));
  const body = {
    name: 'HTTP Sponsor',
    acceptTerms: true,
    termsVersion: 'test-v1',
  };
  await request(server)
    .post('/api/v1/sponsor/profile')
    .set('Origin', origin)
    .send(body)
    .expect(401);
  await request(server)
    .post('/api/v1/sponsor/profile')
    .set('Cookie', cookie)
    .set('Origin', 'https://evil.test')
    .send(body)
    .expect(403);
  await request(server)
    .post('/api/v1/sponsor/profile')
    .set('Cookie', cookie)
    .set('Origin', origin)
    .send({ ...body, ownerId: 'forged' })
    .expect(400);
  const profile = await request(server)
    .post('/api/v1/sponsor/profile')
    .set('Cookie', cookie)
    .set('Origin', origin)
    .send(body)
    .expect(201);
  const [link] = await db.select().from(schema.authAccountLinks);
  assert.equal(profile.body.ownerId, link!.accountId);
  assert.equal(profile.body.contactEmail, email);
  const read = await request(server)
    .get('/api/v1/sponsor/profile')
    .set('Cookie', cookie)
    .expect(200);
  assert.equal(read.body.id, profile.body.id);
  await request(server)
    .post('/api/v1/sponsor/tasks')
    .set('Cookie', cookie)
    .set('Origin', origin)
    .send({
      requestId: '397fd682-d913-46cd-88c9-d797795b7ef2',
      title: 'Test',
      instructions: 'Write an article',
      proofRequirements: 'Document',
      rejectionCriteria: 'Copied work',
      model: 'selected_assignment',
      capacity: 1,
      rewardKobo: '100',
      startsAt: new Date(Date.now() + 86400000).toISOString(),
      endsAt: new Date(Date.now() + 172800000).toISOString(),
    })
    .expect(409);
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
  assert.equal(app.getHttpAdapter().getInstance().get('trust proxy'), false);
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

test('rotating forged client IP headers cannot evade the authentication rate limit', async () => {
  await db.delete(schema.authRateLimits);
  try {
    let limited = false;
    for (let attempt = 1; attempt <= 31; attempt++) {
      const forged = `203.0.113.${attempt}`;
      const result = await request(server)
        .post('/api/v1/auth/sign-in/email')
        .set('Origin', origin)
        .set('X-Pointrush-Client-IP', forged)
        .set('X-Forwarded-For', `${forged}, 198.51.100.1`)
        .set('CF-Connecting-IP', forged)
        .set('X-Real-IP', forged)
        .send({});
      assert.ok([400, 429].includes(result.status));
      if (result.status === 429) {
        limited = true;
        break;
      }
    }
    assert.ok(
      limited,
      'Forged IP rotation must not reset the rate-limit bucket',
    );
  } finally {
    await db.delete(schema.authRateLimits);
  }
});

test('review HTTP boundary rejects missing MFA, expired assurance and missing grants', async () => {
  const login = await request(server)
    .post('/api/v1/auth/sign-in/email')
    .set('Origin', origin)
    .send({ email, password })
    .expect(200);
  const headers = login.headers['set-cookie'] as unknown as string[];
  cookie = headers
    .find((value) => value.includes('session_token'))!
    .split(';')[0]!;

  await request(server).get('/api/v1/admin/reviews/tasks').expect(401);
  await request(server)
    .get('/api/v1/admin/reviews/tasks')
    .set('Cookie', cookie)
    .expect(403);
  const session = await service.getSession({ cookie });
  assert.ok(session);
  const factorId = randomUUID();
  await db.insert(schema.authTwoFactors).values({
    id: factorId,
    userId: session.user.id,
    secret: 'synthetic-factor',
    backupCodes: 'synthetic-backups',
    verified: true,
  });
  await db
    .update(schema.authUsers)
    .set({ twoFactorEnabled: true })
    .where(eq(schema.authUsers.id, session.user.id));
  // Synthetic assurance isolates the Nest boundary. Real TOTP is tested in admin-mfa.test.
  await db
    .insert(schema.authMfaSessions)
    .values({ sessionId: session.session.id, factorId });
  await request(server)
    .get('/api/v1/admin/reviews/tasks')
    .set('Cookie', cookie)
    .expect(403);
  const [link] = await db
    .select()
    .from(schema.authAccountLinks)
    .where(eq(schema.authAccountLinks.authUserId, session.user.id));
  assert.ok(link);
  const [grant] = await db
    .insert(schema.taskReviewerGrants)
    .values({
      reviewerId: link.accountId,
      grantedBy: link.accountId,
      reason: 'Synthetic HTTP appointment',
      expiresAt: new Date(Date.now() + 3600000),
    })
    .returning();
  assert.ok(grant);
  const [available] = await db
    .select()
    .from(schema.fundingAccounts)
    .where(eq(schema.fundingAccounts.ownerId, link.accountId));
  assert.ok(available);
  const [clearing] = await db
    .insert(schema.fundingAccounts)
    .values({ bucket: 'clearing' })
    .returning();
  assert.ok(clearing);
  await postFundingTransfer(db, {
    id: randomUUID(),
    sourceId: clearing.id,
    destinationId: available.id,
    actorId: link.accountId,
    amountKobo: 9007199254740993n,
    kind: 'funding_confirmed',
    reference: `http-test:${randomUUID()}`,
    reason: 'Synthetic HTTP test funding',
  });
  const created = await request(server)
    .post('/api/v1/sponsor/tasks')
    .set('Cookie', cookie)
    .set('Origin', origin)
    .send({
      requestId: randomUUID(),
      title: 'Funded HTTP task',
      instructions: 'Write original guide',
      proofRequirements: 'Guide document',
      rejectionCriteria: 'Copied work',
      model: 'capped_fixed',
      capacity: 1,
      rewardKobo: '9007199254740993',
      startsAt: new Date(Date.now() + 86400000).toISOString(),
      endsAt: new Date(Date.now() + 172800000).toISOString(),
    })
    .expect(201);
  const detail = await request(server)
    .get(`/api/v1/admin/reviews/tasks/${created.body.id}`)
    .set('Cookie', cookie)
    .expect(200);
  assert.equal(detail.body.rewardKobo, '9007199254740993');
  assert.equal(detail.body.budgetKobo, '9007199254740993');
  await request(server).get('/api/v1/work/tasks').expect(401);
  await request(server).get('/api/v1/work/appeals').expect(401);
  await request(server)
    .get('/api/v1/work/appeals')
    .set('Cookie', cookie)
    .expect(403);
  const discovery = await request(server)
    .get('/api/v1/work/tasks?limit=1')
    .set('Cookie', cookie)
    .expect(200);
  assert.ok(Array.isArray(discovery.body.items));
  assert.ok(
    !discovery.body.items.some(
      (item: { id: string }) => item.id === created.body.id,
    ),
  );
  await request(server)
    .get('/api/v1/work/tasks?limit=51')
    .set('Cookie', cookie)
    .expect(400);
  await request(server)
    .get('/api/v1/work/claims?accountId=forged')
    .set('Cookie', cookie)
    .expect(400);
  const owned = await request(server)
    .get('/api/v1/work/sponsor/tasks')
    .set('Cookie', cookie)
    .expect(200);
  assert.equal(owned.body.items[0].id, created.body.id);

  // Purchase campaign routes share session, Origin and conflict-reason handling.
  await request(server).get('/api/v1/purchases').expect(401);
  await request(server)
    .post(`/api/v1/campaigns/${created.body.id}/codes`)
    .set('Cookie', cookie)
    .send({})
    .expect(403);
  const unpublished = await request(server)
    .post(`/api/v1/campaigns/${created.body.id}/codes`)
    .set('Cookie', cookie)
    .set('Origin', origin)
    .send({})
    .expect(409);
  assert.equal(unpublished.body.reason, 'offer_unavailable');
  await request(server)
    .post('/api/v1/campaigns/not-a-uuid/codes')
    .set('Cookie', cookie)
    .set('Origin', origin)
    .send({})
    .expect(400);
  await request(server)
    .get(`/api/v1/campaigns/${created.body.id}/summary`)
    .set('Cookie', cookie)
    .expect(404);
  const purchases = await request(server)
    .get('/api/v1/purchases?limit=5')
    .set('Cookie', cookie)
    .expect(200);
  assert.deepEqual(purchases.body.items, []);
  await request(server)
    .get('/api/v1/purchases?accountId=forged')
    .set('Cookie', cookie)
    .expect(400);

  await request(server)
    .post(`/api/v1/work/tasks/${created.body.id}/publish`)
    .set('Origin', origin)
    .expect(401);
  await request(server)
    .post(`/api/v1/work/tasks/${created.body.id}/publish`)
    .set('Cookie', cookie)
    .send({})
    .expect(403);
  await request(server)
    .post(`/api/v1/work/tasks/${created.body.id}/publish`)
    .set('Cookie', cookie)
    .set('Origin', origin)
    .send({})
    .expect(409);
  await request(server)
    .get(`/api/v1/work/tasks/${created.body.id}`)
    .set('Cookie', cookie)
    .expect(404);
  await request(server)
    .post(`/api/v1/work/appeals/${randomUUID()}/resolutions`)
    .set('Cookie', cookie)
    .set('Origin', origin)
    .send({
      id: randomUUID(),
      decision: 'approved',
      reason: 'Task review grant is not arbitration permission',
    })
    .expect(403);

  await request(server)
    .post(`/api/v1/admin/reviews/tasks/${created.body.id}/decision`)
    .set('Cookie', cookie)
    .set('Origin', origin)
    .send({
      requestId: randomUUID(),
      termsVersion: detail.body.termsVersion,
      termsHash: detail.body.termsHash,
      decision: 'approved',
      reason: 'Self-review must fail',
      checklist: {
        permittedObjective: true,
        clearInstructions: true,
        feasibleProof: true,
        fairRewardTerms: true,
        safeDestinations: true,
      },
    })
    .expect(403);
  const result = await request(server)
    .get('/api/v1/admin/reviews/tasks?limit=1')
    .set('Cookie', cookie)
    .expect(200);
  assert.ok(Array.isArray(result.body.items));
  await request(server)
    .get('/api/v1/admin/reviews/tasks?limit=999')
    .set('Cookie', cookie)
    .expect(400);
  await request(server)
    .post(`/api/v1/admin/reviews/tasks/${randomUUID()}/decision`)
    .set('Cookie', cookie)
    .send({})
    .expect(403);
  await request(server)
    .post(`/api/v1/admin/reviews/tasks/${randomUUID()}/decision`)
    .set('Cookie', cookie)
    .set('Origin', origin)
    .send({ taskId: randomUUID() })
    .expect(400);
  await db.insert(schema.appealReviewerGrants).values({
    accountId: link.accountId,
    grantedBy: link.accountId,
    reason: 'Synthetic appeal queue appointment',
    expiresAt: new Date(Date.now() + 3600000),
  });
  const appeals = await request(server)
    .get('/api/v1/work/appeals?limit=1')
    .set('Cookie', cookie)
    .expect(200);
  assert.ok(Array.isArray(appeals.body.items));
  await request(server)
    .get('/api/v1/work/appeals?limit=51')
    .set('Cookie', cookie)
    .expect(400);
  await db
    .update(schema.authMfaSessions)
    .set({ verifiedAt: new Date(Date.now() - 16 * 60000) })
    .where(eq(schema.authMfaSessions.sessionId, session.session.id));
  await request(server)
    .get('/api/v1/admin/reviews/tasks')
    .set('Cookie', cookie)
    .expect(403);
  await request(server)
    .get('/api/v1/work/appeals')
    .set('Cookie', cookie)
    .expect(403);
  await db
    .delete(schema.authTwoFactors)
    .where(eq(schema.authTwoFactors.id, factorId));
  await db
    .update(schema.authUsers)
    .set({ twoFactorEnabled: false })
    .where(eq(schema.authUsers.id, session.user.id));
});
