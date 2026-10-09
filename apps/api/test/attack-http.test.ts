import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { after, before, test } from 'node:test';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { and, eq, sql } from 'drizzle-orm';
import request from 'supertest';
import { postFundingTransfer } from '../src/funding/funding-ledger.js';
import { TaskWorkModule } from '../src/tasks/task-work.module.js';
import { ReviewsModule } from '../src/reviews/reviews.module.js';
import { CampaignsModule } from '../src/campaigns/campaigns.module.js';
import { PaymentsModule } from '../src/payments/payments.module.js';
import { PhoneModule } from '../src/phone/phone.module.js';
import { BillsModule } from '../src/bills/bills.module.js';
import { TestBillProvider } from '../src/bills/provider.js';
import { FilesModule } from '../src/files/files.module.js';
import { MemoryStorage } from '../src/files/storage.js';
import { TestPaymentProvider } from '../src/payments/provider.js';
import { AppModule } from '../src/app.module.js';
import { AuthService } from '../src/auth/auth.service.js';
import { createAuth } from '../src/auth/auth.factory.js';
import type { AuthEmail } from '../src/auth/auth.email.js';
import { DatabaseService } from '../src/database/database.service.js';
import * as schema from '../src/database/schema.js';
import { configureHttp } from '../src/http/configure-http.js';
import { TaskReviewService } from '../src/reviews/task-review.service.js';
import { taskReviewChecklist } from '../src/reviews/task-review.schema.js';
import { lowLimits } from './helpers/settings.js';

// Postman-style attacks against the running API: a signed-in person tries
// to approve tasks, move money, raise balances, withdraw or read what is
// not theirs, using only HTTP. Every attempt must fail and leave the
// ledger unchanged.

const pg = new PGlite();
const db = drizzle(pg, { schema });
const origin = 'https://acticlaim.test';
const config = {
  secret: randomBytes(32).toString('hex'),
  baseURL: 'https://api.acticlaim.test',
  trustedOrigins: [origin],
  emailFrom: 'test@acticlaim.test',
  emailEncryptionKey: randomBytes(32).toString('hex'),
};
const mailbox: AuthEmail[] = [];
const auth = createAuth(db, config, async (message) => {
  mailbox.push(message);
});
const service = new AuthService(auth, config.baseURL, config.trustedOrigins);
const payments = new TestPaymentProvider(randomBytes(32).toString('hex'));
const password = 'A long test password for attacks 123!';
let app: NestExpressApplication;
let server: Parameters<typeof request>[0];

type Person = { cookie: string; account: string; username: string };
let attacker: Person;
let shopper: Person;
let merchant: Person;
let campaignId: string;
let purchaseId: string;
let reviewerAccount: string;

async function person(name: string): Promise<Person> {
  const email = `${name}@acticlaim.test`;
  await request(server)
    .post('/api/v1/auth/sign-up/email')
    .set('Origin', origin)
    .send({ email, password, name })
    .expect(200);
  const message = mailbox.find((m) => m.to === email)!;
  const url = new URL(message.url);
  await request(server)
    .get(url.pathname + url.search)
    .expect(302);
  const login = await request(server)
    .post('/api/v1/auth/sign-in/email')
    .set('Origin', origin)
    .send({ email, password })
    .expect(200);
  const cookie = (login.headers['set-cookie'] as unknown as string[])
    .find((c) => c.includes('session_token'))!
    .split(';')[0]!;
  await request(server)
    .post('/api/v1/accounts/me')
    .set('Origin', origin)
    .set('Cookie', cookie)
    .send({ username: name, displayName: name })
    .expect(201);
  const me = await request(server)
    .get('/api/v1/accounts/me')
    .set('Cookie', cookie)
    .expect(200);
  return { cookie, account: me.body.account.id, username: name };
}
const post = (who: Person, path: string, body: unknown = {}) =>
  request(server)
    .post(`/api/v1/${path}`)
    .set('Origin', origin)
    .set('Cookie', who.cookie)
    .send(body as object);

// Every account's balance per bucket, to prove nothing moved.
async function balances() {
  const result = await db.execute(sql`
    select a.owner_id, a.bucket,
      coalesce(sum(case when f.destination_id = a.id then f.amount_kobo else -f.amount_kobo end), 0)::text as balance
    from funding_accounts a left join funding_transfers f on f.source_id = a.id or f.destination_id = a.id
    group by a.id, a.owner_id, a.bucket order by a.id`);
  return JSON.stringify(result.rows);
}
const refused = (status: number) =>
  assert.ok(status >= 400 && status < 500, `expected refusal, got ${status}`);

before(async () => {
  await migrate(db, { migrationsFolder: resolve('migrations') });
  await lowLimits(db);
  const module = await Test.createTestingModule({
    imports: [
      AppModule.forRoot(undefined, config, 'test-v1'),
      ReviewsModule,
      TaskWorkModule,
      CampaignsModule,
      PaymentsModule.forRoot(payments),
      PhoneModule.forRoot(),
      BillsModule.forRoot(new TestBillProvider()),
      FilesModule.forRoot(new MemoryStorage()),
    ],
  })
    .overrideProvider(DatabaseService)
    .useValue({ db, isReady: async () => true })
    .overrideProvider(AuthService)
    .useValue(service)
    .compile();
  app = module.createNestApplication<NestExpressApplication>({
    logger: false,
    rawBody: true,
    bodyParser: false,
  });
  configureHttp(
    app,
    { nodeEnv: 'test', port: 8080, corsOrigins: [origin] },
    service.handler,
  );
  await app.init();
  server = app.getHttpServer() as Parameters<typeof request>[0];

  attacker = await person('attacker');
  shopper = await person('shopper');
  merchant = await person('merchant');
  // Verified phones, so the attacker meets every account rule.
  let n = 0;
  for (const p of [attacker, shopper, merchant])
    await db.insert(schema.verifiedPhones).values({
      accountId: p.account,
      phoneNumber: `+23481300000${++n}`,
    });
  // The merchant: a business with real funding (as if a bank transfer
  // was confirmed), and a live, reviewed cash back campaign.
  await post(merchant, 'sponsor/profile', {
    name: 'Victim Foods',
    acceptTerms: true,
    termsVersion: 'test-v1',
  }).expect(201);
  await db.insert(schema.fundingAccounts).values({ bucket: 'clearing' });
  const [clearing] = await db
    .select()
    .from(schema.fundingAccounts)
    .where(eq(schema.fundingAccounts.bucket, 'clearing'));
  const [available] = await db
    .select()
    .from(schema.fundingAccounts)
    .where(
      and(
        eq(schema.fundingAccounts.ownerId, merchant.account),
        eq(schema.fundingAccounts.bucket, 'available'),
      ),
    );
  await postFundingTransfer(db, {
    id: randomUUID(),
    sourceId: clearing!.id,
    destinationId: available!.id,
    amountKobo: 1_000_000n,
    actorId: merchant.account,
    kind: 'funding_confirmed',
    reference: `bank:${randomUUID()}`,
    reason: 'Confirmed deposit',
  });
  const start = new Date(Date.now() + 1500);
  const created = await post(merchant, 'sponsor/tasks', {
    requestId: randomUUID(),
    title: 'Lunch cash back',
    instructions: 'Buy lunch and show your code.',
    proofRequirements: 'Purchase confirmed by the business in the shop.',
    rejectionCriteria: 'Refunds.',
    model: 'purchase_cashback',
    capacity: 10,
    rewardKobo: '50000',
    startsAt: start.toISOString(),
    endsAt: new Date(start.getTime() + 86400000).toISOString(),
    campaignTerms: {
      minSpendKobo: '100000',
      holdHours: 24,
      placeName: 'Victim Foods',
      placeAddress: '1 Allen Avenue, Ikeja',
    },
  }).expect(201);
  campaignId = created.body.id;
  // The merchant cannot approve its own campaign through the API.
  refused(
    (
      await post(merchant, `admin/reviews/tasks/${campaignId}/decision`, {
        decision: 'approved',
      })
    ).status,
  );
  refused((await post(merchant, `work/tasks/${campaignId}/publish`)).status);
  // A real reviewer approves it (outside the attacker's reach).
  reviewerAccount = (
    await db.insert(schema.accounts).values({}).returning()
  )[0]!.id;
  await db.insert(schema.taskReviewerGrants).values({
    reviewerId: reviewerAccount,
    grantedBy: reviewerAccount,
    reason: 'Attack test reviewer',
    expiresAt: new Date(Date.now() + 3600000),
  });
  const [row] = await db
    .select()
    .from(schema.sponsorTasks)
    .where(eq(schema.sponsorTasks.id, campaignId));
  await new TaskReviewService(db).decide(reviewerAccount, {
    taskId: campaignId,
    requestId: randomUUID(),
    termsVersion: row!.termsVersion,
    termsHash: row!.requestHash,
    decision: 'approved',
    reason: 'Clear offer',
    checklist: { ...taskReviewChecklist },
  });
  await post(merchant, `work/tasks/${campaignId}/publish`).expect(201);
  await new Promise((r) => setTimeout(r, 1600));
  // The victim shopper buys; their cash back is held.
  const code = await post(shopper, `campaigns/${campaignId}/codes`).expect(201);
  const confirmed = await post(
    merchant,
    `campaigns/${campaignId}/confirmations`,
    {
      id: randomUUID(),
      code: code.body.code,
      amountKobo: '200000',
    },
  ).expect(201);
  purchaseId = confirmed.body.id;
});
after(async () => {
  await app?.close();
  await pg.close();
});

test('without a session or from another site, nothing works', async () => {
  for (const [method, path] of [
    ['get', 'points'],
    ['get', 'purchases'],
    ['post', 'wallet/withdrawals'],
    ['post', `purchases/${purchaseId}/releases`],
    ['post', 'admin/settings'],
  ] as const)
    assert.equal(
      (await request(server)[method](`/api/v1/${path}`).set('Origin', origin))
        .status,
      401,
      path,
    );
  // A forged form post from another website (cookie but wrong origin).
  for (const bad of [undefined, 'https://evil.example'])
    assert.equal(
      (
        await request(server)
          .post(`/api/v1/purchases/${purchaseId}/releases`)
          .set('Cookie', shopper.cookie)
          .set(bad ? { Origin: bad } : {})
          .send({})
      ).status,
      403,
    );
});

test('a normal person cannot reach any admin or reviewer action', async () => {
  const before = await balances();
  const attempts: [string, unknown][] = [
    [`admin/reviews/tasks/${campaignId}/decision`, { decision: 'approved' }],
    ['admin/settings', { settings: {}, reason: 'Make rewards huge' }],
    [
      'admin/referrals/topups',
      {
        id: randomUUID(),
        amountKobo: '100000000',
        bankReference: 'x',
        reason: 'Free money',
      },
    ],
    [
      `admin/accounts/${shopper.account}/access`,
      { id: randomUUID(), toState: 'suspended', reason: 'Spite' },
    ],
    [`admin/accounts/${attacker.account}/withdrawal-unlocks`, {}],
    [
      `admin/disputes/${purchaseId}/rulings`,
      { decision: 'reversed', reason: 'Pay me' },
    ],
    [`admin/ratings/${randomUUID()}/removals`, { reason: 'Bad review' }],
    [
      `admin/profile-changes/${randomUUID()}/decisions`,
      { decision: 'applied', reason: 'Mine' },
    ],
    [
      `work/appeals/${randomUUID()}/resolutions`,
      { decision: 'approved', reason: 'Pay me' },
    ],
  ];
  for (const [path, body] of attempts)
    assert.equal((await post(attacker, path, body)).status, 403, path);
  for (const path of [
    'admin/analytics',
    'admin/search?q=shopper',
    'admin/settings',
  ])
    assert.equal(
      (
        await request(server)
          .get(`/api/v1/${path}`)
          .set('Cookie', attacker.cookie)
      ).status,
      403,
      path,
    );
  assert.equal(await balances(), before);
});

test('balances cannot be written, and money cannot be moved to the attacker', async () => {
  const before = await balances();
  // There is no endpoint that sets a balance, in any shape.
  for (const method of ['put', 'patch', 'post', 'delete'] as const)
    for (const path of [
      'wallet',
      'wallet/balance',
      'points',
      `accounts/${attacker.account}`,
      'funding/transfers',
    ]) {
      const call = request(server)[method];
      const { status } = await call(`/api/v1/${path}`)
        .set('Origin', origin)
        .set('Cookie', attacker.cookie)
        .send({ walletKobo: '999999999', amountKobo: '999999999' });
      assert.ok([403, 404, 405].includes(status), `${method} ${path}`);
    }
  // Taking the victim's held cash back.
  refused((await post(attacker, `purchases/${purchaseId}/releases`)).status);
  // Confirming a purchase at someone else's business for yourself.
  const own = await post(attacker, `campaigns/${campaignId}/codes`).expect(201);
  refused(
    (
      await post(attacker, `campaigns/${campaignId}/confirmations`, {
        id: randomUUID(),
        code: own.body.code,
        amountKobo: '200000',
      })
    ).status,
  );
  // Voiding, returning funds or summarising another business's campaign.
  refused(
    (await post(attacker, `purchases/${purchaseId}/voids`, { reason: 'x' }))
      .status,
  );
  refused(
    (
      await post(attacker, `campaigns/${campaignId}/returns`, {
        id: randomUUID(),
      })
    ).status,
  );
  refused(
    (
      await request(server)
        .get(`/api/v1/campaigns/${campaignId}/summary`)
        .set('Cookie', attacker.cookie)
    ).status,
  );
  // Extra fields that try to choose an owner or amount are refused, not ignored.
  refused(
    (
      await post(attacker, `campaigns/${campaignId}/codes`, {
        accountId: shopper.account,
        cashbackKobo: '99999999',
      })
    ).status,
  );
  refused(
    (
      await post(merchant, `campaigns/${campaignId}/confirmations`, {
        id: randomUUID(),
        code: own.body.code,
        amountKobo: '200000',
        cashbackKobo: '99999999',
        accountId: attacker.account,
      })
    ).status,
  );
  // A forged payment-provider message cannot credit anyone.
  for (const signature of [undefined, 'sha256=forged'])
    refused(
      (
        await request(server)
          .post('/api/v1/payments/webhooks/test')
          .set('Content-Type', 'application/json')
          .set(signature ? { 'X-Test-Signature': signature } : {})
          .send(
            JSON.stringify({
              type: 'payment.succeeded',
              reference: `intent:${randomUUID()}`,
              amountKobo: '100000000',
            }),
          )
      ).status,
    );
  assert.equal(await balances(), before);
});

test('withdrawals and bills only spend your own money, with your password', async () => {
  const before = await balances();
  const withdraw = (body: Record<string, unknown>) =>
    post(attacker, 'wallet/withdrawals', {
      id: randomUUID(),
      amountKobo: '100000',
      ...body,
    });
  // No password, a wrong one, or someone else's account in the body.
  assert.equal((await withdraw({})).body.reason, 'password_required');
  assert.equal(
    (await withdraw({ password: 'guess' })).body.reason,
    'password_required',
  );
  refused((await withdraw({ password, accountId: shopper.account })).status);
  refused((await withdraw({ password, amountKobo: '-100000' })).status);
  refused((await withdraw({ password, amountKobo: '1e9' })).status);
  // The attacker has nothing in the wallet; the request is refused.
  refused((await withdraw({ password })).status);
  // Bills from an empty wallet, or with a forged price.
  refused(
    (
      await post(attacker, 'wallet/bills', {
        id: randomUUID(),
        kind: 'airtime',
        biller: 'mtn',
        customerRef: '08031234567',
        amountKobo: '10000',
        password,
      })
    ).status,
  );
  assert.equal(await balances(), before);
});

test('a business cannot lock money it does not have or approve its own work', async () => {
  await post(attacker, 'sponsor/profile', {
    name: 'Attacker Ventures',
    acceptTerms: true,
    termsVersion: 'test-v1',
  }).expect(201);
  // Opening a business adds an empty wallet; nothing else may change.
  const before = await balances();
  // No funds: creating a campaign locks nothing and is refused.
  const start = new Date(Date.now() + 60000);
  refused(
    (
      await post(attacker, 'sponsor/tasks', {
        requestId: randomUUID(),
        title: 'Free money',
        instructions: 'Nothing.',
        proofRequirements: 'Nothing.',
        rejectionCriteria: 'Nothing.',
        model: 'purchase_cashback',
        capacity: 1000,
        rewardKobo: '1000000',
        startsAt: start.toISOString(),
        endsAt: new Date(start.getTime() + 86400000).toISOString(),
        campaignTerms: {
          minSpendKobo: '0',
          holdHours: 24,
          placeName: 'Nowhere',
          placeAddress: 'Nowhere',
        },
      })
    ).status,
  );
  // Funding requests only create a pending payment; nothing is credited
  // until the provider's signed message arrives.
  const intent = await post(attacker, 'payments/funding-intents', {
    id: randomUUID(),
    amountKobo: '100000000',
  });
  assert.ok([201, 503].includes(intent.status));
  assert.equal(await balances(), before);
});

test('nobody reads or rates what is not theirs', async () => {
  // Another person's purchases, claims and files.
  const theirs = await request(server)
    .get('/api/v1/purchases')
    .set('Cookie', attacker.cookie)
    .expect(200);
  assert.ok(
    !JSON.stringify(theirs.body).includes(purchaseId),
    'another shopper’s purchase leaked',
  );
  refused(
    (
      await request(server)
        .get(`/api/v1/work/claims/${randomUUID()}`)
        .set('Cookie', attacker.cookie)
    ).status,
  );
  // Rating a business you never bought from.
  const handle = (
    await db.execute(
      sql`select handle from business_handles h join sponsor_profiles sp on sp.id = h.sponsor_id where sp.owner_id = ${merchant.account}`,
    )
  ).rows[0] as { handle: string };
  assert.equal(
    (await post(attacker, `businesses/${handle.handle}/ratings`, { stars: 1 }))
      .body.reason,
    'rating_unavailable',
  );
  // Referring yourself.
  refused(
    (await post(attacker, 'points/referral', { username: 'attacker' })).status,
  );
});
