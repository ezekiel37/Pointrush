import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, test } from 'node:test';
import { eq, sql } from 'drizzle-orm';
import * as s from '../src/database/schema.js';
import { CampaignsService } from '../src/campaigns/campaigns.service.js';
import { PointsService, tierFor } from '../src/points/points.service.js';
import { ProfilesService } from '../src/points/profiles.service.js';
import { TaskReviewService } from '../src/reviews/task-review.service.js';
import { taskReviewChecklist } from '../src/reviews/task-review.schema.js';
import { campaignFixture } from './helpers/campaign-fixture.js';
import type { Identity } from './helpers/campaign-fixture.js';

const {
  pg,
  db,
  identity,
  travel,
  business,
  campaign,
  fund,
  sponsors,
  work,
  reviewer,
} = await campaignFixture();
const campaigns = new CampaignsService(db);
const points = new PointsService(db);
after(() => pg.close());

let phones = 0;
async function phone(account: string) {
  phones += 1;
  await db.insert(s.verifiedPhones).values({
    accountId: account,
    phoneNumber: `+234800${String(phones).padStart(7, '0')}`,
  });
}
async function username(person: Identity, name: string) {
  await db
    .insert(s.usernames)
    .values({ username: name, accountId: person.account, isCurrent: true });
}
async function pool(amount: bigint) {
  const funder = await identity();
  await db
    .insert(s.pointsPools)
    .values({ points: amount, actorId: funder.account, reason: 'Launch pool' });
}
// A full purchase: code, till confirmation, hold, release.
async function buy(
  shopper: Identity,
  run: Awaited<ReturnType<typeof campaign>>,
) {
  const code = await campaigns.activate(shopper.user, run.id);
  const confirmed = await campaigns.confirm(run.merchant.user, run.id, {
    id: randomUUID(),
    code: code.code,
    amountKobo: '500000',
  });
  await travel('25 hours');
  try {
    await campaigns.release(shopper.user, confirmed.id);
  } finally {
    await travel('0');
  }
  return confirmed.id;
}
async function balance(person: Identity) {
  const summary = await points.summary(person.user);
  return BigInt(summary.points.available) + BigInt(summary.points.pending);
}
async function reason(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    const response = (error as { getResponse?: () => unknown }).getResponse?.();
    return (response as { reason?: string })?.reason ?? (error as Error).name;
  }
  assert.fail('Expected rejection');
}

test('tiers count distinct businesses, never points or spending', () => {
  assert.equal(tierFor(0).name, 'New');
  assert.deepEqual(tierFor(2).next, { name: 'Bronze', businesses: 3 });
  assert.equal(tierFor(3).name, 'Bronze');
  assert.equal(tierFor(10).name, 'Silver');
  assert.equal(tierFor(40).name, 'Gold');
  assert.equal(tierFor(40).next, null);
});

test('settlement is never blocked by points: no pool or no phone earns nothing', async () => {
  const shopper = await identity();
  await buy(shopper, await campaign(1));
  assert.equal(await balance(shopper), 0n);
  assert.equal((await points.summary(shopper.user)).tier.businesses, 1);
});

test('purchase points are a capped fraction of cash back, once per business', async () => {
  await pool(1000000n);
  const shopper = await identity();
  await phone(shopper.account);
  const merchant = await business('Repeat Bakery');
  await buy(shopper, await campaign(1, '50000', merchant));
  // 50,000 kobo cash back is worth 1,000 points; purchase points cap at 50.
  assert.equal(await balance(shopper), 50n);
  // A second campaign at the same business earns cash back but no new points.
  await buy(shopper, await campaign(1, '50000', merchant));
  assert.equal(await balance(shopper), 50n);
  // A tiny campaign earns only a fifth of its value: 1,000 kobo -> 20 points.
  await buy(shopper, await campaign(1, '1000'));
  assert.equal(await balance(shopper), 70n);
  const summary = await points.summary(shopper.user);
  assert.equal(summary.points.available, '0');
  // Three released purchases: 50,000 + 50,000 + 1,000 kobo of cash back.
  assert.equal(summary.walletKobo, '101000');
  assert.equal(summary.tier.businesses, 2);
  // Points were issued at release (25 hours ahead), and unlock 72 hours later.
  await travel('98 hours');
  try {
    assert.equal((await points.summary(shopper.user)).points.available, '70');
  } finally {
    await travel('0');
  }
  const entries = await points.entries(shopper.user);
  assert.equal(entries.items.length, 2);
  assert.ok(entries.items.some((e) => e.businessName === 'Repeat Bakery'));
});

test('points never exceed the pool and forged entries are rejected', async () => {
  const issued = await db
    .select({
      total: sql<string>`coalesce(sum(${s.pointsEntries.points}),0)::text`,
    })
    .from(s.pointsEntries);
  const capacity = await db
    .select({
      total: sql<string>`coalesce(sum(${s.pointsPools.points}),0)::text`,
    })
    .from(s.pointsPools);
  // Leave room for exactly one more 50-point award.
  const room = BigInt(capacity[0]!.total) - BigInt(issued[0]!.total);
  const [drain] = await db
    .select({ id: s.pointsPools.id })
    .from(s.pointsPools)
    .limit(1);
  assert.ok(drain);
  await assert.rejects(
    db.execute(sql`update points_pools set points = 1 where id = ${drain.id}`),
  );
  assert.ok(room > 100n);
  const a = await identity();
  const b = await identity();
  await phone(a.account);
  await phone(b.account);
  const purchase = await buy(a, await campaign(1));
  // Forgery: wrong amount, someone else's purchase, invented kinds.
  for (const values of [
    {
      accountId: a.account,
      kind: 'purchase',
      reference: `purchase:${purchase}`,
      points: 10000n,
    },
    {
      accountId: b.account,
      kind: 'purchase',
      reference: `purchase:${purchase}`,
      points: 50n,
    },
    {
      accountId: b.account,
      kind: 'job',
      reference: `claim:${randomUUID()}`,
      points: 300n,
    },
    {
      accountId: b.account,
      kind: 'bonus',
      reference: `purchase:${purchase}`,
      points: 1n,
    },
  ])
    await assert.rejects(
      db.insert(s.pointsEntries).values({ ...values, availableAt: new Date() }),
    );
  await assert.rejects(
    db.execute(sql`delete from points_entries where account_id = ${a.account}`),
  );

  // A fresh, nearly empty pool environment: awards stop at the cap.
  const small = await campaignFixture();
  try {
    const shopper = await small.identity();
    const funder = await small.identity();
    await small.db.insert(s.verifiedPhones).values({
      accountId: shopper.account,
      phoneNumber: '+2348009999999',
    });
    await small.db
      .insert(s.pointsPools)
      .values({ points: 60n, actorId: funder.account, reason: 'Tiny' });
    const service = new CampaignsService(small.db);
    for (let i = 0; i < 2; i++) {
      const run = await small.campaign(1);
      const code = await service.activate(shopper.user, run.id);
      const confirmed = await service.confirm(run.merchant.user, run.id, {
        id: randomUUID(),
        code: code.code,
        amountKobo: '500000',
      });
      await small.travel('25 hours');
      await service.release(shopper.user, confirmed.id);
      await small.travel('0');
    }
    const summary = await new PointsService(small.db).summary(shopper.user);
    assert.equal(summary.points.pending, '50');
    assert.equal(summary.tier.businesses, 2);
  } finally {
    await small.pg.close();
  }
});

test('referrals reward only qualified, independent activity within caps', async () => {
  const referrer = await identity();
  await username(referrer, 'ada_earns');
  const referee = await identity();

  // A referrer without real activity cannot attract attributions.
  assert.equal(
    await reason(points.refer(referee.user, { username: 'ada_earns' })),
    'referral_unavailable',
  );
  await phone(referrer.account);
  await buy(referrer, await campaign(1));
  await assert.rejects(
    points.refer(referee.user, { username: 'nobody_here' }),
    {
      status: 404,
    },
  );
  assert.equal(
    await reason(points.refer(referrer.user, { username: 'ada_earns' })),
    'referral_unavailable',
  );
  await points.refer(referee.user, { username: 'ADA_EARNS' });
  await points.refer(referee.user, { username: 'ada_earns' });
  await assert.rejects(points.refer(referee.user, { username: 'other_one' }));

  // Activity at the referrer's own business never qualifies the referral.
  await business('Ada Stores', referrer);
  const referrerShop = await campaign(1, '50000', referrer);
  const before = await balance(referrer);
  await buy(referee, referrerShop);
  assert.equal(await balance(referrer), before);
  // Without a verified phone the referee does not qualify either.
  await buy(referee, await campaign(1));
  assert.equal(await balance(referrer), before);
  // Verifying the phone completes qualification and pays both sides once.
  await phone(referee.account);
  assert.equal(await balance(referrer), before + 500n);
  assert.equal(await balance(referee), 200n);
  await buy(referee, await campaign(1));
  assert.equal(await balance(referrer), before + 500n);
  const summary = await points.summary(referrer.user);
  assert.equal(summary.referral.code, 'ada_earns');
  assert.equal(summary.referral.rewarded, 1);
  assert.equal(
    (await points.summary(referee.user)).referral.referredBy,
    'ada_earns',
  );

  // Circular and late referrals are rejected.
  await username(referee, 'bola_buys');
  assert.equal(
    await reason(points.refer(referrer.user, { username: 'bola_buys' })),
    'referral_unavailable',
  );
  const late = await identity();
  await travel('8 days');
  try {
    assert.equal(
      await reason(points.refer(late.user, { username: 'ada_earns' })),
      'referral_unavailable',
    );
  } finally {
    await travel('0');
  }
});

test('a referrer earns at most five referral rewards in thirty days', async () => {
  const referrer = await identity();
  await username(referrer, 'cap_tester');
  await phone(referrer.account);
  await buy(referrer, await campaign(1));
  const shop = await campaign(7);
  for (let i = 0; i < 7; i++) {
    const referee = await identity();
    await phone(referee.account);
    await points.refer(referee.user, { username: 'cap_tester' });
    await buy(referee, shop);
  }
  const rewarded = await db
    .select()
    .from(s.pointsEntries)
    .where(eq(s.pointsEntries.accountId, referrer.account));
  assert.equal(
    rewarded.filter((e) => e.kind === 'referral_referrer').length,
    5,
  );
});

test('credibility profile is opt-in, derived from settled records and private about shopping', async () => {
  const profiles = new ProfilesService(db);
  const person = await identity();
  await username(person, 'tolu_proven');
  await db
    .insert(s.accountProfiles)
    .values({ accountId: person.account, displayName: 'Tolu A.' });
  await buy(person, await campaign(1));

  // A paid job from a business, through the existing reviewed work flow.
  const client = await business('Lagos Design Studio');
  await fund(client.account, 400000n);
  for (let i = 0; i < 2; i++) {
    const start = new Date(Date.now() + 400);
    const job = await sponsors.createTask(client.user, {
      requestId: randomUUID(),
      title: `Product photos, batch ${i + 1}`,
      instructions: 'Shoot 10 product photos on a white background.',
      proofRequirements: 'Link to the delivered photo set.',
      rejectionCriteria: 'Blurred or reused images.',
      model: 'capped_fixed',
      capacity: 1,
      rewardKobo: '200000',
      startsAt: start.toISOString(),
      endsAt: new Date(start.getTime() + 86400000).toISOString(),
      workTerms: {
        reviewHours: 24,
        correctionHours: 24,
        appealHours: 48,
        settlement: 'approved_reward_backing',
      },
    });
    const [row] = await db
      .select()
      .from(s.sponsorTasks)
      .where(eq(s.sponsorTasks.id, job.id));
    await new TaskReviewService(db).decide(reviewer, {
      taskId: row!.id,
      requestId: randomUUID(),
      termsVersion: row!.termsVersion,
      termsHash: row!.requestHash,
      decision: 'approved',
      reason: 'Clear paid brief',
      checklist: { ...taskReviewChecklist },
    });
    await work.publish(client.user, job.id);
    await new Promise((r) =>
      setTimeout(r, Math.max(0, start.getTime() - Date.now() + 20)),
    );
    const claim = await work.join(person.user, job.id);
    const proof = await work.submit(person.user, claim.id, {
      id: randomUUID(),
      revision: 1,
      evidence: 'https://example.test/photos',
    });
    await work.decide(client.user, proof.id, {
      id: randomUUID(),
      decision: 'approved',
      reason: 'Delivered as briefed',
    });
  }

  await assert.rejects(profiles.publicProfile('tolu_proven'), { status: 404 });
  const own = await profiles.own(person.user);
  assert.equal(own.public, false);
  await profiles.setVisibility(person.user, { public: true });
  const shown = await profiles.publicProfile('TOLU_PROVEN');
  assert.equal(shown.displayName, 'Tolu A.');
  assert.deepEqual(shown.stats, {
    businesses: 2,
    jobsCompleted: 2,
    repeatClients: 1,
    purchases: 1,
  });
  assert.equal(shown.work.length, 2);
  assert.ok(shown.work.every((w) => w.businessName === 'Lagos Design Studio'));
  // Shopping history is a count only: no purchase business appears anywhere.
  assert.ok(!JSON.stringify(shown).includes('Mama Put Kitchen'));
  assert.equal('public' in shown, false);

  await assert.rejects(profiles.publicProfile('no_such_person'), {
    status: 404,
  });
  await assert.rejects(profiles.publicProfile('../etc'), { status: 404 });
  await profiles.setVisibility(person.user, { public: false });
  await assert.rejects(profiles.publicProfile('tolu_proven'), { status: 404 });
  await profiles.setVisibility(person.user, { public: true });
  await db.execute(
    sql`update accounts set access_state = 'suspended' where id = ${person.account}`,
  );
  await assert.rejects(profiles.publicProfile('tolu_proven'), { status: 404 });
  await assert.rejects(profiles.setVisibility(person.user, { public: true }), {
    status: 403,
  });
});
