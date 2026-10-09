import { lowLimits } from './settings.js';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { and, eq } from 'drizzle-orm';
import * as s from '../../src/database/schema.js';
import { SponsorsService } from '../../src/sponsors/sponsors.service.js';
import { TaskReviewService } from '../../src/reviews/task-review.service.js';
import { taskReviewChecklist } from '../../src/reviews/task-review.schema.js';
import { TaskWorkService } from '../../src/tasks/task-work.service.js';
import { postFundingTransfer } from '../../src/funding/funding-ledger.js';

export const campaignTerms = {
  minSpendKobo: '300000',
  holdHours: 24,
  placeName: 'Mama Put Kitchen',
  placeAddress: '12 Campus Road, Ibadan',
};

export type Identity = { user: string; account: string };

// In-memory database with a test-only clock: triggers resolve clock_timestamp()
// through search_path, so tests can cross holds without waiting.
export async function campaignFixture() {
  const pg = new PGlite();
  const db = drizzle(pg, { schema: s });
  await migrate(db, { migrationsFolder: resolve('migrations') });
  await lowLimits(db);
  await pg.exec(`
    create schema test_clock;
    create function test_clock.clock_timestamp() returns timestamptz language sql volatile as
      $$ select pg_catalog.clock_timestamp() + coalesce(nullif(current_setting('test.offset', true), ''), '0')::interval $$;
    set search_path = test_clock, pg_catalog, public;
  `);
  const clearing = (
    await db
      .insert(s.fundingAccounts)
      .values({ bucket: 'clearing' })
      .returning()
  )[0]!.id;
  const sponsors = new SponsorsService({ db }, 'test');
  const work = new TaskWorkService(db);

  async function identity(): Promise<Identity> {
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
  const reviewer = (await identity()).account;
  await db.insert(s.taskReviewerGrants).values({
    reviewerId: reviewer,
    grantedBy: reviewer,
    reason: 'Synthetic',
    expiresAt: new Date(Date.now() + 3600000),
  });

  async function travel(offset: string) {
    await pg.query(`select set_config('test.offset', $1, false)`, [offset]);
  }

  async function fund(account: string, amountKobo: bigint) {
    const [available] = await db
      .select()
      .from(s.fundingAccounts)
      .where(
        and(
          eq(s.fundingAccounts.ownerId, account),
          eq(s.fundingAccounts.bucket, 'available'),
        ),
      );
    await postFundingTransfer(db, {
      id: randomUUID(),
      sourceId: clearing,
      destinationId: available!.id,
      amountKobo,
      actorId: account,
      kind: 'funding_confirmed',
      reference: randomUUID(),
      reason: 'Synthetic funding',
    });
  }

  async function business(name = 'Mama Put Kitchen', person?: Identity) {
    const merchant = person ?? (await identity());
    await sponsors.createProfile(merchant.user, {
      name,
      termsVersion: 'test',
      acceptTerms: true,
    });
    return merchant;
  }

  // Funds, reviews and publishes a live purchase campaign for a business.
  async function campaign(
    capacity = 2,
    cashback = '50000',
    merchant?: Identity,
    options: { terms?: Record<string, unknown>; days?: number } = {},
  ) {
    const owner = merchant ?? (await business());
    await fund(owner.account, BigInt(cashback) * BigInt(capacity));
    const start = new Date(Date.now() + 400);
    const created = await sponsors.createTask(owner.user, {
      requestId: randomUUID(),
      title: 'Lunch cash back',
      instructions: 'Buy any meal and show your Acticlaim code at the counter.',
      proofRequirements: 'Purchase confirmed by the business at the till.',
      rejectionCriteria: 'Refunded or cancelled orders.',
      model: 'purchase_cashback',
      capacity,
      rewardKobo: cashback,
      startsAt: start.toISOString(),
      endsAt: new Date(
        start.getTime() + (options.days ?? 2) * 86400000,
      ).toISOString(),
      campaignTerms: { ...campaignTerms, ...options.terms },
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
    await work.publish(owner.user, created.id);
    await new Promise((r) =>
      setTimeout(r, Math.max(0, start.getTime() - Date.now() + 20)),
    );
    return {
      merchant: owner,
      id: created.id,
      allocation: created.allocationAccountId,
    };
  }

  // Funds and creates a cash back campaign that has not been reviewed yet.
  async function draft(merchant?: Identity, capacity = 1, cashback = '50000') {
    const owner = merchant ?? (await business());
    await fund(owner.account, BigInt(cashback) * BigInt(capacity));
    const start = new Date(Date.now() + 3600000);
    const created = await sponsors.createTask(owner.user, {
      requestId: randomUUID(),
      title: 'Draft cash back',
      instructions: 'Buy any meal and show your Acticlaim code at the counter.',
      proofRequirements: 'Purchase confirmed by the business at the till.',
      rejectionCriteria: 'Refunded or cancelled orders.',
      model: 'purchase_cashback',
      capacity,
      rewardKobo: cashback,
      startsAt: start.toISOString(),
      endsAt: new Date(start.getTime() + 2 * 86400000).toISOString(),
      campaignTerms,
    });
    const [row] = await db
      .select()
      .from(s.sponsorTasks)
      .where(eq(s.sponsorTasks.id, created.id));
    const decide = (
      decision: 'approved' | 'changes_required' | 'rejected',
      reason: string,
    ) =>
      new TaskReviewService(db).decide(reviewer, {
        taskId: row!.id,
        requestId: randomUUID(),
        termsVersion: row!.termsVersion,
        termsHash: row!.requestHash,
        decision,
        reason,
        checklist: { ...taskReviewChecklist },
      });
    return {
      merchant: owner,
      id: created.id,
      allocation: created.allocationAccountId,
      decide,
    };
  }

  // Funds, reviews and publishes a live claim-code prize promotion.
  async function promotion(
    prizes = 3,
    prizeKobo = '100000',
    terms: Record<string, unknown> = {},
  ) {
    const owner = await business('Fizz Drinks');
    await fund(owner.account, BigInt(prizeKobo) * BigInt(prizes));
    const start = new Date(Date.now() + 400);
    const created = await sponsors.createTask(owner.user, {
      requestId: randomUUID(),
      title: 'Scratch and win',
      instructions: 'Every code under the cap wins. Enter it to claim.',
      proofRequirements: 'A valid, unclaimed winning code.',
      rejectionCriteria: 'Invalid, used or withdrawn codes.',
      model: 'claim_code',
      capacity: prizes,
      rewardKobo: prizeKobo,
      startsAt: start.toISOString(),
      endsAt: new Date(start.getTime() + 2 * 86400000).toISOString(),
      promotionTerms: {
        mode: 'every_code_wins',
        permit: null,
        claimLimitPerPerson: 1,
        howToGetCodes: 'Buy any 50cl Fizz at participating stores.',
        ...terms,
      },
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
      reason: 'Permit and prize terms checked',
      checklist: { ...taskReviewChecklist },
    });
    await work.publish(owner.user, created.id);
    await new Promise((r) =>
      setTimeout(r, Math.max(0, start.getTime() - Date.now() + 20)),
    );
    return {
      merchant: owner,
      id: created.id,
      allocation: created.allocationAccountId,
    };
  }

  return {
    promotion,
    pg,
    db,
    sponsors,
    work,
    reviewer,
    identity,
    travel,
    fund,
    business,
    campaign,
    draft,
  };
}
