import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { after, before, test } from 'node:test';
import { HttpException } from '@nestjs/common';
import { Client } from 'pg';
import { and, eq, sql } from 'drizzle-orm';
import * as s from '../../src/database/schema.js';
import type { DatabaseConfig } from '../../src/database/database.config.js';
import { readDatabaseConfig } from '../../src/database/database.config.js';
import { DatabaseService } from '../../src/database/database.service.js';
import { runMigrations } from '../../src/database/migrate.js';
import { fundingAccounts } from '../../src/funding/funding.schema.js';
import {
  fundingBalance,
  postFundingTransfer,
} from '../../src/funding/funding-ledger.js';
import { SponsorsService } from '../../src/sponsors/sponsors.service.js';
import { RatingsService } from '../../src/sponsors/ratings.service.js';
import { TaskReviewService } from '../../src/reviews/task-review.service.js';
import { taskReviewChecklist } from '../../src/reviews/task-review.schema.js';
import { TaskWorkService } from '../../src/tasks/task-work.service.js';
import { PromotionsService } from '../../src/promotions/promotions.service.js';
import { PaymentsService } from '../../src/payments/payments.service.js';
import { TestPaymentProvider } from '../../src/payments/provider.js';
import { BillsService } from '../../src/bills/bills.service.js';
import { TestBillProvider } from '../../src/bills/provider.js';
import { ProfileEditsService } from '../../src/profiles/profile-edits.service.js';
import { AdminService } from '../../src/admin/admin.service.js';
import { lowLimits } from '../helpers/settings.js';

// Each racing call runs on its own connection pool, so the database, not
// Node's event loop, decides who wins. Every race checks two things: the
// rule held, and every loser got a clean 4xx (never a 500).

const databaseName = `pointrush_race_${randomUUID().replaceAll('-', '')}`;
let admin: Client;
let config: DatabaseConfig;
let main: DatabaseService;
const pools: DatabaseService[] = [];
let phones = 0;

before(async () => {
  if (!process.env.TEST_DATABASE_URL)
    throw new Error(
      'TEST_DATABASE_URL is required; native database tests must not silently skip',
    );
  const adminConfig = readDatabaseConfig({
    ...process.env,
    DATABASE_URL: process.env.TEST_DATABASE_URL,
  });
  assert.ok(adminConfig);
  admin = new Client(adminConfig);
  await admin.connect();
  await admin.query(`CREATE DATABASE "${databaseName}"`);
  const url = new URL(adminConfig.connectionString);
  url.pathname = `/${databaseName}`;
  config = { ...adminConfig, connectionString: url.toString() };
  await runMigrations(config, resolve('migrations'));
  main = new DatabaseService(config);
  for (let i = 0; i < 8; i++) pools.push(new DatabaseService(config));
  await lowLimits(main.db);
});

after(async () => {
  await Promise.all(
    [main, ...pools].map((p) => p?.onApplicationShutdown?.() ?? undefined),
  );
  await admin?.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
  await admin?.end();
});

const db = () => main.db;
const on = (i: number) => pools[i % pools.length]!.db;

async function person(verified = true) {
  const user = randomUUID();
  await db()
    .insert(s.authUsers)
    .values({
      id: user,
      name: 'Racer',
      email: `${user}@example.test`,
      emailVerified: true,
    });
  const [account] = await db().insert(s.accounts).values({}).returning();
  await db()
    .insert(s.authAccountLinks)
    .values({ accountId: account!.id, authUserId: user });
  if (verified)
    await db()
      .insert(s.verifiedPhones)
      .values({
        accountId: account!.id,
        phoneNumber: `+2348${String(++phones).padStart(9, '0')}`,
      });
  return { user, account: account!.id };
}

async function reviewer() {
  const who = await person(false);
  await db()
    .insert(s.taskReviewerGrants)
    .values({
      reviewerId: who.account,
      grantedBy: who.account,
      reason: 'Race test',
      expiresAt: new Date(Date.now() + 3600000),
    });
  return who;
}

async function clearing() {
  await db()
    .insert(fundingAccounts)
    .values({ bucket: 'clearing' })
    .onConflictDoNothing();
  const [row] = await db()
    .select()
    .from(fundingAccounts)
    .where(eq(fundingAccounts.bucket, 'clearing'));
  return row!.id;
}

async function walletOf(account: string) {
  const [row] = await db()
    .select()
    .from(fundingAccounts)
    .where(
      and(
        eq(fundingAccounts.ownerId, account),
        eq(fundingAccounts.bucket, 'reward_wallet'),
      ),
    );
  return row ? fundingBalance(db(), row.id) : 0n;
}

// A business running an approved, live "every code wins" promotion.
async function promotion(codes: number, rewardKobo: bigint, perPerson = 1) {
  const owner = await person();
  const sponsors = new SponsorsService(main, 'test-v1');
  const profile = await sponsors.createProfile(owner.user, {
    name: `Race shop ${randomUUID().slice(0, 6)}`,
    acceptTerms: true,
    termsVersion: 'test-v1',
  });
  const [available] = await db()
    .select()
    .from(fundingAccounts)
    .where(eq(fundingAccounts.ownerId, owner.account));
  await postFundingTransfer(db(), {
    id: randomUUID(),
    sourceId: await clearing(),
    destinationId: available!.id,
    amountKobo: rewardKobo * BigInt(codes),
    actorId: owner.account,
    kind: 'funding_confirmed',
    reference: `test:${randomUUID()}`,
    reason: 'Race test',
  });
  const start = new Date(Date.now() + 1000);
  const created = await sponsors.createTask(owner.user, {
    requestId: randomUUID(),
    title: 'Race prize',
    instructions: 'Scratch to reveal',
    proofRequirements: 'Winning code',
    rejectionCriteria: 'Invalid codes',
    model: 'claim_code',
    capacity: codes,
    rewardKobo: rewardKobo.toString(),
    startsAt: start.toISOString(),
    endsAt: new Date(start.getTime() + 86400000).toISOString(),
    promotionTerms: {
      mode: 'every_code_wins',
      permit: null,
      claimLimitPerPerson: perPerson,
      howToGetCodes: 'One code in every crate',
    },
  });
  const staff = await reviewer();
  const [row] = await db()
    .select()
    .from(s.sponsorTasks)
    .where(eq(s.sponsorTasks.id, created.id));
  await new TaskReviewService(db()).decide(staff.account, {
    taskId: row!.id,
    requestId: randomUUID(),
    termsVersion: row!.termsVersion,
    termsHash: row!.requestHash,
    decision: 'approved',
    reason: 'Race approval',
    checklist: { ...taskReviewChecklist },
  });
  await new TaskWorkService(db()).publish(owner.user, created.id);
  await new Promise((r) => setTimeout(r, start.getTime() - Date.now() + 50));
  const promotions = new PromotionsService(db());
  const batch = await promotions.createBatch(owner.user, created.id, {
    id: randomUUID(),
    label: 'Race crate',
    size: codes,
  });
  await promotions.activateBatch(owner.user, batch.batchId);
  return {
    owner,
    profile,
    staff,
    task: created,
    codes: batch.codes as string[],
  };
}

function claim(i: number, who: { user: string }, code: string) {
  return new PromotionsService(on(i)).claim(who.user, {
    id: randomUUID(),
    code,
  });
}

// Losers must be told no, cleanly. A 500 means the race leaked through.
function settle<T>(results: PromiseSettledResult<T>[]) {
  for (const r of results)
    if (r.status === 'rejected') {
      const status =
        r.reason instanceof HttpException ? r.reason.getStatus() : 500;
      assert.ok(
        status < 500,
        `A racing call failed with ${status}: ${String(r.reason)}`,
      );
    }
  return results.filter((r) => r.status === 'fulfilled').length;
}

test('racing withdrawals and bill payments cannot overdraw a wallet or pass the daily count', async () => {
  // ₦5,000 in the wallet; withdrawals are capped at 3 a day.
  const { codes } = await promotion(5, 100000n, 5);
  const shopper = await person();
  for (const code of codes) await claim(0, shopper, code);
  assert.equal(await walletOf(shopper.account), 500000n);
  const provider = new TestPaymentProvider(
    'race-webhook-secret-long-enough-000000',
  );
  await new PaymentsService(db(), provider).addDestination(shopper.user, {
    bankCode: '058',
    accountNumber: '0123456789',
  });
  const bills = new TestBillProvider();
  const results = await Promise.allSettled([
    ...Array.from({ length: 6 }, (_, i) =>
      new PaymentsService(on(i), provider).requestWithdrawal(shopper.user, {
        id: randomUUID(),
        amountKobo: '100000',
      }),
    ),
    ...Array.from({ length: 4 }, (_, i) =>
      new BillsService(on(i + 6), bills).buy(shopper.user, {
        id: randomUUID(),
        kind: 'airtime',
        biller: 'mtn',
        customerRef: '08031234567',
        amountKobo: '100000',
      }),
    ),
  ]);
  settle(results);
  const withdrawals = results
    .slice(0, 6)
    .filter((r) => r.status === 'fulfilled').length;
  const paidBills = results
    .slice(6)
    .filter((r) => r.status === 'fulfilled').length;
  assert.ok(withdrawals <= 3, `${withdrawals} withdrawals passed a cap of 3`);
  // Exactly the ₦5,000 held: never more, and no valid request refused.
  assert.equal(withdrawals + paidBills, 5);
  const left = await walletOf(shopper.account);
  assert.ok(left >= 0n);
  // Every naira is accounted for: what left is what was approved.
  const [held] = await db()
    .execute<{ total: string }>(
      sql`
    select coalesce(sum(amount_kobo), 0)::text as total from funding_transfers f
    join funding_accounts a on a.id = f.source_id
    where a.owner_id = ${shopper.account} and a.bucket = 'reward_wallet'`,
    )
    .then((r) => r.rows);
  assert.equal(BigInt(held!.total), 500000n - left);
  assert.equal(BigInt(held!.total), BigInt(withdrawals + paidBills) * 100000n);
});

test('a customer rating twice at once leaves one rating; a business replying twice at once leaves one reply', async () => {
  const { codes, owner } = await promotion(1, 100000n);
  const customer = await person();
  await claim(0, customer, codes[0]!);
  const handle = (await new ProfileEditsService(db()).mine(owner.user))
    .handle as string;
  const rated = await Promise.allSettled(
    Array.from({ length: 6 }, (_, i) =>
      new RatingsService(on(i)).rate(customer.user, handle, {
        stars: (i % 5) + 1,
        comment: `Take ${i}`,
      }),
    ),
  );
  assert.ok(settle(rated) >= 1);
  const ratings = await db()
    .select()
    .from(s.businessRatings)
    .where(eq(s.businessRatings.accountId, customer.account));
  assert.equal(ratings.length, 1);
  const replies = await Promise.allSettled(
    Array.from({ length: 6 }, (_, i) =>
      new RatingsService(on(i)).reply(owner.user, ratings[0]!.id, {
        body: `Thanks ${i}`,
      }),
    ),
  );
  assert.equal(settle(replies), 1);
  const [count] = await db()
    .execute<{ n: number }>(
      sql`select count(*)::int as n from business_rating_replies where rating_id = ${ratings[0]!.id}`,
    )
    .then((r) => r.rows);
  assert.equal(count!.n, 1);
});

test('racing handle changes use the one free change once; racing name changes keep one per week', async () => {
  const owner = await person();
  await new SponsorsService(main, 'test-v1').createProfile(owner.user, {
    name: 'Race kitchen',
    acceptTerms: true,
    termsVersion: 'test-v1',
    handle: 'race_kitchen',
  });
  const handles = await Promise.allSettled(
    Array.from({ length: 6 }, (_, i) =>
      new ProfileEditsService(on(i)).changeHandle(owner.user, {
        handle: `race_kitchen_${i}`,
      }),
    ),
  );
  assert.equal(settle(handles), 1);
  const [held] = await db()
    .execute<{ n: number }>(
      sql`select count(*)::int as n from business_handles h join sponsor_profiles sp on sp.id = h.sponsor_id
        where sp.owner_id = ${owner.account}`,
    )
    .then((r) => r.rows);
  assert.equal(held!.n, 2);

  const who = await person();
  await db().insert(s.usernames).values({
    username: 'race_runner',
    accountId: who.account,
    isCurrent: true,
  });
  await db()
    .insert(s.accountProfiles)
    .values({ accountId: who.account, displayName: 'Racer' });
  const names = await Promise.allSettled(
    Array.from({ length: 6 }, (_, i) =>
      new ProfileEditsService(on(i)).changeDisplayName(who.user, {
        displayName: `Racer ${i}`,
      }),
    ),
  );
  assert.equal(settle(names), 1);
  const [changes] = await db()
    .execute<{ n: number }>(
      sql`select count(*)::int as n from display_name_changes where account_id = ${who.account}`,
    )
    .then((r) => r.rows);
  assert.equal(changes!.n, 1);
});

test('two reviewers deciding one rename at once record one decision, and the name matches it', async () => {
  const { owner, profile } = await promotion(1, 100000n);
  const edits = new ProfileEditsService(db());
  const id = randomUUID();
  assert.equal(
    (await edits.change(owner.user, { id, field: 'name', value: 'Renamed' }))
      .state,
    'pending',
  );
  const staff = [await reviewer(), await reviewer()];
  const decisions = await Promise.allSettled(
    staff.map((r, i) =>
      new AdminService(on(i)).decideProfileChange(r.user, id, {
        decision: i === 0 ? 'applied' : 'rejected',
        reason: 'Race decision',
      }),
    ),
  );
  assert.equal(settle(decisions), 1);
  const [decision] = await db()
    .select()
    .from(s.businessProfileDecisions)
    .where(eq(s.businessProfileDecisions.changeId, id));
  const [now] = await db()
    .select({ name: s.sponsorProfiles.name })
    .from(s.sponsorProfiles)
    .where(eq(s.sponsorProfiles.id, profile.id));
  assert.equal(
    now!.name,
    decision!.decision === 'applied' ? 'Renamed' : profile.name,
  );
});

async function referralsOn(monthlyCount: number) {
  await db().execute(sql`
    insert into platform_settings (settings, reason)
    select jsonb_set(jsonb_set(settings, '{referrals,enabled}', 'true'),
      '{referrals,monthlyCount}', ${String(monthlyCount)}::jsonb), 'Race referrals'
    from platform_settings order by version desc limit 1`);
  const staff = await reviewer();
  const topup = randomUUID();
  await db().execute(sql`
    insert into referral_pool_topups (id, amount_kobo, actor_id, bank_reference, reason)
    values (${topup}, 100000000, ${staff.account}, 'RACE-1', 'Race pool')`);
  await db().execute(sql`
    insert into funding_accounts (bucket) values ('referral_pool') on conflict do nothing`);
  await db().execute(sql`
    insert into funding_transfers (id, source_id, destination_id, amount_kobo, kind, reference, actor_id, reason)
    values (gen_random_uuid(), ${await clearing()},
      (select id from funding_accounts where bucket = 'referral_pool'),
      100000000, 'referral_pool_funded', ${`referral-topup:${topup}`}, ${staff.account}, 'Race pool')`);
}

async function invite(inviter: { account: string }) {
  const friend = await person();
  await db()
    .insert(s.referrals)
    .values({ referrerId: inviter.account, refereeId: friend.account });
  return friend;
}

test('friends paid at the same moment cannot push their inviter past the monthly referral cap', async () => {
  await referralsOn(2);
  const inviter = await person();
  const friends = [];
  for (let i = 0; i < 5; i++) friends.push(await invite(inviter));
  const { codes } = await promotion(5, 100000n);
  // Every friend's prize must still be paid, whatever happens to the reward.
  const claims = await Promise.allSettled(
    friends.map((f, i) => claim(i, f, codes[i]!)),
  );
  assert.equal(settle(claims), 5);
  const [rewards] = await db()
    .execute<{ n: number; total: string }>(
      sql`select count(*)::int as n, coalesce(sum(amount_kobo), 0)::text as total
        from referral_rewards where referrer_id = ${inviter.account}`,
    )
    .then((r) => r.rows);
  assert.equal(rewards!.n, 2);
  assert.equal(await walletOf(inviter.account), BigInt(rewards!.total));
});

test('an inviter paid at the same moment as their friend never sees a failed payout', async () => {
  // The inviter's own payout and the referral reward from their friend both
  // touch the inviter's wallet and the shared referral pool, in opposite
  // order. Repeated to give a deadlock a fair chance to show.
  await referralsOn(100);
  const failures: string[] = [];
  for (let round = 0; round < 30; round++) {
    const top = await person();
    const inviter = await invite(top);
    const friend = await invite(inviter);
    // Real inviters usually have a wallet already.
    await db()
      .insert(fundingAccounts)
      .values([
        { ownerId: inviter.account, bucket: 'reward_wallet' },
        { ownerId: top.account, bucket: 'reward_wallet' },
      ]);
    const [a, b] = [await promotion(1, 100000n), await promotion(1, 100000n)];
    const results = await Promise.allSettled([
      claim(0, friend, a.codes[0]!),
      claim(1, inviter, b.codes[0]!),
    ]);
    for (const r of results)
      if (r.status === 'rejected') failures.push(String(r.reason));
    // Both rewards were really paid, so both paths really ran.
    assert.equal(await walletOf(inviter.account), 100000n + 20000n);
    assert.equal(await walletOf(top.account), 20000n);
  }
  assert.deepEqual(failures, []);
});
