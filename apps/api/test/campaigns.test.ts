import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { after, before, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { eq, sql } from 'drizzle-orm';
import * as s from '../src/database/schema.js';
import { CampaignsService } from '../src/campaigns/campaigns.service.js';
import { SponsorsService } from '../src/sponsors/sponsors.service.js';
import { TaskReviewService } from '../src/reviews/task-review.service.js';
import { taskReviewChecklist } from '../src/reviews/task-review.schema.js';
import { TaskWorkService } from '../src/tasks/task-work.service.js';
import { TaskQueriesService } from '../src/tasks/task-queries.service.js';
import {
  fundingBalance,
  postFundingTransfer,
} from '../src/funding/funding-ledger.js';

const pg = new PGlite();
const db = drizzle(pg, { schema: s });
const campaigns = new CampaignsService(db);
const work = new TaskWorkService(db);
const sponsors = new SponsorsService({ db }, 'test');
let clearing: string;
let reviewer: string;

// Test-only clock: triggers resolve clock_timestamp() through search_path, so a
// shadowing function lets tests cross the refund hold without waiting a day.
async function travel(offset: string) {
  await pg.query(`select set_config('test.offset', $1, false)`, [offset]);
}

before(async () => {
  await migrate(db, { migrationsFolder: resolve('migrations') });
  await pg.exec(`
    create schema test_clock;
    create function test_clock.clock_timestamp() returns timestamptz language sql volatile as
      $$ select pg_catalog.clock_timestamp() + coalesce(nullif(current_setting('test.offset', true), ''), '0')::interval $$;
    set search_path = test_clock, pg_catalog, public;
  `);
  clearing = (
    await db
      .insert(s.fundingAccounts)
      .values({ bucket: 'clearing' })
      .returning()
  )[0]!.id;
  reviewer = (await identity()).account;
  await db.insert(s.taskReviewerGrants).values({
    reviewerId: reviewer,
    grantedBy: reviewer,
    reason: 'Synthetic',
    expiresAt: new Date(Date.now() + 3600000),
  });
});
after(() => pg.close());

async function identity() {
  const user = randomUUID();
  const account = (await db.insert(s.accounts).values({}).returning())[0]!.id;
  await db.insert(s.authUsers).values({
    id: user,
    email: `${user}@example.test`,
    name: 'Synthetic',
    emailVerified: true,
  });
  await db
    .insert(s.authAccountLinks)
    .values({ accountId: account, authUserId: user });
  return { user, account };
}

const terms = {
  minSpendKobo: '300000',
  holdHours: 24,
  placeName: 'Mama Put Kitchen',
  placeAddress: '12 Campus Road, Ibadan',
};

async function campaign(capacity = 2, cashback = '50000') {
  const merchant = await identity();
  await sponsors.createProfile(merchant.user, {
    name: 'Mama Put Kitchen',
    termsVersion: 'test',
    acceptTerms: true,
  });
  const [available] = await db
    .select()
    .from(s.fundingAccounts)
    .where(eq(s.fundingAccounts.ownerId, merchant.account));
  await postFundingTransfer(db, {
    id: randomUUID(),
    sourceId: clearing,
    destinationId: available!.id,
    amountKobo: BigInt(cashback) * BigInt(capacity),
    actorId: merchant.account,
    kind: 'funding_confirmed',
    reference: randomUUID(),
    reason: 'Synthetic funding',
  });
  const start = new Date(Date.now() + 400);
  const created = await sponsors.createTask(merchant.user, {
    requestId: randomUUID(),
    title: 'Lunch cash back',
    instructions: 'Buy any meal and show your PointRush code at the counter.',
    proofRequirements: 'Purchase confirmed by the business at the till.',
    rejectionCriteria: 'Refunded or cancelled orders.',
    model: 'purchase_cashback',
    capacity,
    rewardKobo: cashback,
    startsAt: start.toISOString(),
    endsAt: new Date(start.getTime() + 2 * 86400000).toISOString(),
    campaignTerms: terms,
  });
  const [row] = await db
    .select()
    .from(s.sponsorTasks)
    .where(eq(s.sponsorTasks.id, created.id));
  await new TaskReviewService(db).decide(reviewer, {
    taskId: row!.id,
    requestId: randomUUID(),
    termsVersion: row!.termsVersion,
    termsHash: row!.requestHash,
    decision: 'approved',
    reason: 'Clear, lawful purchase offer',
    checklist: { ...taskReviewChecklist },
  });
  await work.publish(merchant.user, created.id);
  await new Promise((r) =>
    setTimeout(r, Math.max(0, start.getTime() - Date.now() + 20)),
  );
  return { merchant, id: created.id, allocation: created.allocationAccountId };
}

const confirmation = (code: string, amountKobo = '450000') => ({
  id: randomUUID(),
  code,
  amountKobo,
});
async function reason(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    const response = (error as { getResponse?: () => unknown }).getResponse?.();
    return (response as { reason?: string })?.reason ?? (error as Error).name;
  }
  assert.fail('Expected rejection');
}
async function wallet(account: string) {
  const [row] = await db
    .select()
    .from(s.fundingAccounts)
    .where(eq(s.fundingAccounts.ownerId, account));
  return row?.bucket === 'reward_wallet' ? fundingBalance(db, row.id) : 0n;
}

test('campaign creation requires campaign terms and never mixes in work terms', async () => {
  const merchant = await identity();
  await sponsors.createProfile(merchant.user, {
    name: 'Kiosk',
    termsVersion: 'test',
    acceptTerms: true,
  });
  const base = {
    requestId: randomUUID(),
    title: 'Cash back',
    instructions: 'Buy',
    proofRequirements: 'Till confirmation',
    rejectionCriteria: 'Refunds',
    model: 'purchase_cashback',
    capacity: 1,
    rewardKobo: '100',
    startsAt: new Date(Date.now() + 60000).toISOString(),
    endsAt: new Date(Date.now() + 120000).toISOString(),
  };
  await assert.rejects(sponsors.createTask(merchant.user, base), {
    status: 400,
  });
  await assert.rejects(
    sponsors.createTask(merchant.user, {
      ...base,
      campaignTerms: { ...terms, holdHours: 2 },
    }),
    { status: 400 },
  );
  await assert.rejects(
    sponsors.createTask(merchant.user, {
      ...base,
      campaignTerms: terms,
      workTerms: {
        reviewHours: 1,
        correctionHours: 1,
        appealHours: 1,
        settlement: 'approved_reward_backing',
      },
    }),
    { status: 400 },
  );
});

test('code -> till confirmation -> hold -> release credits cash back exactly once', async () => {
  const { merchant, id, allocation } = await campaign();
  const shopper = await identity();
  const stranger = await identity();

  const code = await campaigns.activate(shopper.user, id);
  assert.match(code.display, /^[A-HJKMNP-Z2-9]{5}-[A-HJKMNP-Z2-9]{5}$/);
  assert.equal((await campaigns.activate(shopper.user, id)).code, code.code);
  assert.equal(
    await reason(campaigns.activate(merchant.user, id)),
    'offer_unavailable',
  );

  // Only the owning business can confirm, and only at or above the minimum spend.
  await assert.rejects(
    campaigns.confirm(stranger.user, id, confirmation(code.code)),
    { status: 404 },
  );
  assert.equal(
    await reason(
      campaigns.confirm(merchant.user, id, confirmation(code.code, '299999')),
    ),
    'confirmation_rejected',
  );
  assert.equal(
    await reason(
      campaigns.confirm(merchant.user, id, confirmation('ABCDE-FGHJK')),
    ),
    'confirmation_rejected',
  );
  const input = confirmation(code.display.toLowerCase());
  const confirmed = await campaigns.confirm(merchant.user, id, input);
  assert.equal(confirmed.cashbackKobo, '50000');
  assert.equal(
    (await campaigns.confirm(merchant.user, id, input)).id,
    confirmed.id,
  );
  // A photographed code cannot be used again, and one purchase per shopper per campaign.
  assert.equal(
    await reason(campaigns.confirm(merchant.user, id, confirmation(code.code))),
    'not_eligible',
  );
  assert.equal(
    await reason(campaigns.activate(shopper.user, id)),
    'offer_unavailable',
  );

  assert.equal(
    await reason(campaigns.release(shopper.user, confirmed.id)),
    'not_releasable',
  );
  await assert.rejects(campaigns.release(stranger.user, confirmed.id), {
    status: 404,
  });
  const before = await campaigns.purchases(shopper.user);
  assert.equal(before.items[0]?.state, 'pending');

  await travel('25 hours');
  try {
    assert.equal(
      (await campaigns.purchases(shopper.user)).items[0]?.state,
      'releasable',
    );
    // Too late for the business to void once the hold has passed.
    assert.equal(
      await reason(
        campaigns.voidPurchase(merchant.user, confirmed.id, {
          reason: 'Refund',
        }),
      ),
      'void_rejected',
    );
    await campaigns.release(shopper.user, confirmed.id);
    await campaigns.release(shopper.user, confirmed.id);
  } finally {
    await travel('0');
  }
  assert.equal(await wallet(shopper.account), 50000n);
  assert.equal(await fundingBalance(db, allocation), 50000n);
  assert.equal(
    (await campaigns.purchases(shopper.user)).items[0]?.state,
    'released',
  );

  const summary = await campaigns.summary(merchant.user, id);
  assert.equal(summary.confirmed, 1);
  assert.equal(summary.released, 1);
  assert.equal(summary.remaining, 1);
  await assert.rejects(campaigns.summary(shopper.user, id), { status: 404 });
});

test('capacity is enforced, voids reopen a place and voided purchases never pay', async () => {
  const { merchant, id } = await campaign(2);
  const [a, b, c] = [await identity(), await identity(), await identity()];
  const ca = await campaigns.activate(a.user, id);
  const cb = await campaigns.activate(b.user, id);
  const cc = await campaigns.activate(c.user, id);
  const first = await campaigns.confirm(
    merchant.user,
    id,
    confirmation(ca.code),
  );
  await campaigns.confirm(merchant.user, id, confirmation(cb.code));
  assert.equal(
    await reason(campaigns.confirm(merchant.user, id, confirmation(cc.code))),
    'campaign_full',
  );
  await assert.rejects(
    campaigns.voidPurchase(merchant.user, first.id, { reason: ' ' }),
    { status: 400 },
  );
  const voided = await campaigns.voidPurchase(merchant.user, first.id, {
    reason: 'Order refunded at the counter',
  });
  assert.equal(
    (
      await campaigns.voidPurchase(merchant.user, first.id, {
        reason: 'Order refunded at the counter',
      })
    ).createdAt.getTime(),
    voided.createdAt.getTime(),
  );
  await assert.rejects(
    campaigns.voidPurchase(a.user, first.id, { reason: 'Mine' }),
    { status: 404 },
  );
  await campaigns.confirm(merchant.user, id, confirmation(cc.code));
  await travel('25 hours');
  try {
    assert.equal(
      await reason(campaigns.release(a.user, first.id)),
      'not_releasable',
    );
  } finally {
    await travel('0');
  }
  assert.equal(await wallet(a.account), 0n);
  const summary = await campaigns.summary(merchant.user, id);
  assert.deepEqual(
    [summary.confirmed, summary.voided, summary.remaining],
    [3, 1, 0],
  );
  const listed = await new TaskQueriesService(db).discover(c.user, {});
  assert.equal(listed.items.find((item) => item.id === id)?.claimed, 2);
});

test('expired codes, daily shopper limits and code minting are bounded', async () => {
  const shopper = await identity();
  const runs = [];
  for (let i = 0; i < 6; i++) runs.push(await campaign(1, '1000'));
  for (const run of runs.slice(0, 5)) {
    const code = await campaigns.activate(shopper.user, run.id);
    await campaigns.confirm(run.merchant.user, run.id, confirmation(code.code));
  }
  const sixth = runs[5]!;
  const code = await campaigns.activate(shopper.user, sixth.id);
  assert.equal(
    await reason(
      campaigns.confirm(sixth.merchant.user, sixth.id, confirmation(code.code)),
    ),
    'daily_limit',
  );

  const late = await identity();
  const lateCode = await campaigns.activate(late.user, sixth.id);
  await travel('16 minutes');
  try {
    assert.equal(
      await reason(
        campaigns.confirm(
          sixth.merchant.user,
          sixth.id,
          confirmation(lateCode.code),
        ),
      ),
      'confirmation_rejected',
    );
    // An expired code is replaced rather than reused.
    assert.notEqual(
      (await campaigns.activate(late.user, sixth.id)).code,
      lateCode.code,
    );
  } finally {
    await travel('0');
  }
  // Two codes already exist; the hourly limit allows ten per shopper per campaign.
  for (let i = 0; i < 8; i++)
    await db.insert(s.purchaseCodes).values({
      taskId: sixth.id,
      accountId: late.account,
      code: `ZZZZZZZZ${'23456789'[i % 8]}${'ABCDEFGHJ'[i]}`,
      expiresAt: new Date(),
    });
  await assert.rejects(
    db.insert(s.purchaseCodes).values({
      taskId: sixth.id,
      accountId: late.account,
      code: 'ZZZZZZZZZZ',
      expiresAt: new Date(),
    }),
    (error: Error) =>
      String((error.cause as Error)?.message).includes(
        'Too many purchase codes',
      ),
  );
});

test('direct writes cannot bypass release, rewrite history or pay a non-buyer', async () => {
  const { merchant, id, allocation } = await campaign(1);
  const shopper = await identity();
  const thief = await identity();
  const code = await campaigns.activate(shopper.user, id);
  const confirmed = await campaigns.confirm(
    merchant.user,
    id,
    confirmation(code.code),
  );
  await campaigns.release(thief.user, confirmed.id).catch(() => undefined);
  const thiefWallet = (
    await db
      .insert(s.fundingAccounts)
      .values({ ownerId: thief.account, bucket: 'reward_wallet' })
      .returning()
  )[0]!;
  await assert.rejects(
    postFundingTransfer(db, {
      id: randomUUID(),
      sourceId: allocation,
      destinationId: thiefWallet.id,
      amountKobo: 50000n,
      actorId: thief.account,
      kind: 'purchase_cashback',
      reference: `purchase:${confirmed.id}`,
      reason: 'Attempted theft',
    }),
  );
  await assert.rejects(
    db.execute(
      sql`update purchase_confirmations set amount_kobo = 1 where id = ${confirmed.id}`,
    ),
  );
  await assert.rejects(
    db.execute(sql`delete from purchase_codes where id is not null`),
  );
  // Release is refused before the hold even for a direct insert.
  await assert.rejects(
    db.insert(s.purchaseReleases).values({ confirmationId: confirmed.id }),
  );
  assert.equal(await fundingBalance(db, allocation), 50000n);
});
