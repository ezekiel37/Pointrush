import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { after, before, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { eq } from 'drizzle-orm';
import * as s from '../src/database/schema.js';
import { AdminService } from '../src/admin/admin.service.js';
import { taskReviewChecklist } from '../src/reviews/task-review.schema.js';
import { TaskReviewService } from '../src/reviews/task-review.service.js';
import { SponsorsService } from '../src/sponsors/sponsors.service.js';
import { postFundingTransfer } from '../src/funding/funding-ledger.js';
import { lowLimits } from './helpers/settings.js';

// A fresh database with one reviewer: solo admin mode applies until a second
// reviewer is appointed.
const pg = new PGlite();
const db = drizzle(pg, { schema: s });
const reviews = new TaskReviewService(db);
const admin = new AdminService(db);
let clearing: string;
let founder: { user: string; account: string };

before(async () => {
  await migrate(db, { migrationsFolder: resolve('migrations') });
  await lowLimits(db);
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
  founder = await appointed();
});
after(() => pg.close());

const travel = (offset: string) =>
  pg.query(`select set_config('test.offset', $1, false)`, [offset]);

async function identity() {
  const user = randomUUID();
  const account = (await db.insert(s.accounts).values({}).returning())[0]!.id;
  await db.insert(s.authUsers).values({
    id: user,
    name: 'Solo',
    email: `${user}@example.test`,
    emailVerified: true,
  });
  await db
    .insert(s.authAccountLinks)
    .values({ accountId: account, authUserId: user });
  return { user, account };
}

async function appointed() {
  const who = await identity();
  await db.insert(s.taskReviewerGrants).values({
    reviewerId: who.account,
    grantedBy: who.account,
    reason: 'Solo test',
    expiresAt: new Date(Date.now() + 20 * 86400000),
  });
  return who;
}

async function reason(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    const response = (
      error as { getResponse?: () => { reason?: string } }
    ).getResponse?.();
    return response?.reason ?? (error as { status?: number }).status;
  }
  assert.fail('Expected rejection');
}

// A ₦1,000,000 campaign waiting for review.
async function bigCampaign() {
  const owner = await identity();
  const sponsors = new SponsorsService({ db }, 'test-v1');
  await sponsors.createProfile(owner.user, {
    name: `Big shop ${randomUUID().slice(0, 4)}`,
    acceptTerms: true,
    termsVersion: 'test-v1',
  });
  const [available] = await db
    .select()
    .from(s.fundingAccounts)
    .where(eq(s.fundingAccounts.ownerId, owner.account));
  await postFundingTransfer(db, {
    id: randomUUID(),
    sourceId: clearing,
    destinationId: available!.id,
    actorId: owner.account,
    amountKobo: 100000000n,
    kind: 'funding_confirmed',
    reference: `test:${randomUUID()}`,
    reason: 'Solo test',
  });
  const created = await sponsors.createTask(owner.user, {
    requestId: randomUUID(),
    title: 'Big job',
    instructions: 'Write an original guide',
    proofRequirements: 'Document',
    rejectionCriteria: 'Copied work',
    model: 'selected_assignment',
    capacity: 1,
    rewardKobo: '100000000',
    startsAt: new Date(Date.now() + 3 * 86400000).toISOString(),
    endsAt: new Date(Date.now() + 5 * 86400000).toISOString(),
  });
  const [row] = await db
    .select()
    .from(s.sponsorTasks)
    .where(eq(s.sponsorTasks.id, created.id));
  return {
    taskId: row!.id,
    termsVersion: row!.termsVersion,
    termsHash: row!.requestHash,
    decision: 'approved',
    checklist: { ...taskReviewChecklist },
    reason: 'Checked against the current terms',
  };
}

async function state(taskId: string) {
  const [row] = await db
    .select({ state: s.sponsorTasks.reviewState })
    .from(s.sponsorTasks)
    .where(eq(s.sponsorTasks.id, taskId));
  return row!.state;
}

test('the only reviewer can finish a large approval themselves, a day later', async () => {
  const input = await bigCampaign();
  assert.deepEqual(
    await reviews.decide(founder.account, {
      ...input,
      requestId: randomUUID(),
    }),
    { awaitingSecondReviewer: true, taskId: input.taskId },
  );
  assert.equal(
    await reason(
      reviews.decide(founder.account, { ...input, requestId: randomUUID() }),
    ),
    'solo_wait',
  );
  assert.equal(await state(input.taskId), 'pending_review');
  await travel('25 hours');
  try {
    await reviews.decide(founder.account, {
      ...input,
      requestId: randomUUID(),
    });
  } finally {
    await travel('0');
  }
  assert.equal(await state(input.taskId), 'approved');
});

test('the only reviewer can lift their own freeze, a day later and with a reason', async () => {
  const target = await identity();
  const change = (toState: string, why: string) =>
    admin.setAccess(founder.user, target.account, {
      id: randomUUID(),
      toState,
      reason: why,
    });
  await change('suspended', 'Suspected stolen phone');
  assert.equal(await reason(change('active', 'Owner confirmed')), 'solo_wait');
  await travel('25 hours');
  try {
    assert.equal(
      (await change('active', 'Owner confirmed by phone call')).accessState,
      'active',
    );
  } finally {
    await travel('0');
  }
});

test('once a second reviewer exists, both need two different people again', async () => {
  const input = await bigCampaign();
  await reviews.decide(founder.account, { ...input, requestId: randomUUID() });
  const target = await identity();
  await admin.setAccess(founder.user, target.account, {
    id: randomUUID(),
    toState: 'suspended',
    reason: 'Suspected stolen phone',
  });
  const second = await appointed();
  await travel('25 hours');
  try {
    assert.equal(
      await reason(
        reviews.decide(founder.account, { ...input, requestId: randomUUID() }),
      ),
      'second_reviewer_required',
    );
    assert.equal(
      await reason(
        admin.setAccess(founder.user, target.account, {
          id: randomUUID(),
          toState: 'active',
          reason: 'Owner confirmed',
        }),
      ),
      'second_reviewer_required',
    );
    await reviews.decide(second.account, { ...input, requestId: randomUUID() });
    await admin.setAccess(second.user, target.account, {
      id: randomUUID(),
      toState: 'active',
      reason: 'Owner confirmed by phone call',
    });
  } finally {
    await travel('0');
  }
  assert.equal(await state(input.taskId), 'approved');
});
