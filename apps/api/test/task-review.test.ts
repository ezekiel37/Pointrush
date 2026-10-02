import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { before, after, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { eq, sql } from 'drizzle-orm';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import * as schema from '../src/database/schema.js';
import { taskReviewChecklist } from '../src/reviews/task-review.schema.js';
import { TaskReviewService } from '../src/reviews/task-review.service.js';
import { SponsorsService } from '../src/sponsors/sponsors.service.js';
import {
  fundingBalance,
  postFundingTransfer,
} from '../src/funding/funding-ledger.js';

const pg = new PGlite();
const db = drizzle(pg, { schema });
const service = new TaskReviewService(db);
let clearing: string;
before(async () => {
  await migrate(db, { migrationsFolder: resolve('migrations') });
  clearing = (
    await db
      .insert(schema.fundingAccounts)
      .values({ bucket: 'clearing' })
      .returning()
  )[0]!.id;
});
after(async () => {
  await pg.close();
});
async function account() {
  return (await db.insert(schema.accounts).values({}).returning())[0]!.id;
}
async function grant(reviewerId: string, expired = false) {
  return (
    await db
      .insert(schema.taskReviewerGrants)
      .values({
        reviewerId,
        grantedBy: await account(),
        reason: 'Synthetic reviewer appointment',
        createdAt: new Date(Date.now() - 7200000),
        expiresAt: new Date(Date.now() + (expired ? -3600000 : 86400000)),
      })
      .returning()
  )[0]!;
}
async function task() {
  const ownerId = await account();
  const userId = randomUUID();
  await db.insert(schema.authUsers).values({
    id: userId,
    email: `${userId}@example.test`,
    name: 'Test',
    emailVerified: true,
  });
  await db
    .insert(schema.authAccountLinks)
    .values({ accountId: ownerId, authUserId: userId });
  const sponsors = new SponsorsService({ db }, 'test-v1');
  await sponsors.createProfile(userId, {
    name: 'Test',
    acceptTerms: true,
    termsVersion: 'test-v1',
  });
  const [available] = await db
    .select()
    .from(schema.fundingAccounts)
    .where(eq(schema.fundingAccounts.ownerId, ownerId));
  await postFundingTransfer(db, {
    id: randomUUID(),
    sourceId: clearing,
    destinationId: available!.id,
    actorId: ownerId,
    amountKobo: 200n,
    kind: 'funding_confirmed',
    reference: `test:${randomUUID()}`,
    reason: 'Synthetic funds',
  });
  const created = await sponsors.createTask(userId, {
    requestId: randomUUID(),
    title: 'Test',
    instructions: 'Write an original guide',
    proofRequirements: 'Document',
    rejectionCriteria: 'Copied work',
    model: 'selected_assignment',
    capacity: 1,
    rewardKobo: '200',
    startsAt: new Date(Date.now() + 86400000).toISOString(),
    endsAt: new Date(Date.now() + 172800000).toISOString(),
  });
  const [row] = await db
    .select()
    .from(schema.sponsorTasks)
    .where(eq(schema.sponsorTasks.id, created.id));
  return { row: row!, ownerId };
}
function command(row: typeof schema.sponsorTasks.$inferSelect) {
  return {
    taskId: row.id,
    termsVersion: row.termsVersion,
    termsHash: row.requestHash,
    requestId: randomUUID(),
    decision: 'approved',
    checklist: { ...taskReviewChecklist },
    reason: 'All requirements checked against the current terms',
  };
}

test('approval records evidence and updates review status without publishing or moving funds', async () => {
  const { row } = await task();
  const reviewer = await account();
  const permission = await grant(reviewer);
  const input = command(row);
  const result = await service.decide(reviewer, input);
  assert.equal(result.grantId, permission.id);
  assert.equal(result.termsHash, row.requestHash);
  const [updated] = await db
    .select()
    .from(schema.sponsorTasks)
    .where(eq(schema.sponsorTasks.id, row.id));
  assert.equal(updated!.reviewState, 'approved');
  assert.equal(updated!.lifecycle, 'not_live');
  assert.equal(await fundingBalance(db, row.allocationAccountId), 200n);
  assert.equal((await service.decide(reviewer, input)).id, result.id);
  await assert.rejects(
    service.decide(reviewer, { ...input, reason: 'Changed decision evidence' }),
    ConflictException,
  );
  await assert.rejects(
    service.decide(reviewer, { ...input, requestId: randomUUID() }),
    ConflictException,
  );
});

test('absent, expired, revoked and suspended reviewer access are denied', async () => {
  const { row } = await task();
  const absent = await account();
  await assert.rejects(
    service.decide(absent, command(row)),
    ForbiddenException,
  );
  const expired = await account();
  await grant(expired, true);
  await assert.rejects(
    service.decide(expired, command(row)),
    ForbiddenException,
  );
  const revoked = await account();
  const permission = await grant(revoked);
  await db
    .update(schema.taskReviewerGrants)
    .set({
      revokedAt: new Date(),
      revokedBy: permission.grantedBy,
      revocationReason: 'Removed for test',
    })
    .where(eq(schema.taskReviewerGrants.id, permission.id));
  await assert.rejects(
    service.decide(revoked, command(row)),
    ForbiddenException,
  );
  const suspended = await account();
  await grant(suspended);
  await db
    .update(schema.accounts)
    .set({ accessState: 'suspended' })
    .where(eq(schema.accounts.id, suspended));
  await assert.rejects(
    service.decide(suspended, command(row)),
    ForbiddenException,
  );
});

test('self-review, stale versions, changed hashes and incomplete approvals are denied', async () => {
  const { row, ownerId } = await task();
  await grant(ownerId);
  await assert.rejects(
    service.decide(ownerId, command(row)),
    ForbiddenException,
  );
  const reviewer = await account();
  await grant(reviewer);
  await assert.rejects(
    service.decide(reviewer, { ...command(row), termsVersion: 2 }),
    ConflictException,
  );
  await assert.rejects(
    service.decide(reviewer, { ...command(row), termsHash: '0'.repeat(64) }),
    ConflictException,
  );
  await assert.rejects(
    service.decide(reviewer, {
      ...command(row),
      checklist: { ...taskReviewChecklist, safeDestinations: false },
    }),
    BadRequestException,
  );
  await assert.rejects(
    service.decide(reviewer, { ...command(row), reviewerId: ownerId }),
    BadRequestException,
  );
});

test('rejection and changes-required decisions preserve full locked backing', async () => {
  const reviewer = await account();
  await grant(reviewer);
  for (const decision of ['rejected', 'changes_required']) {
    const { row } = await task();
    await service.decide(reviewer, {
      ...command(row),
      decision,
      checklist: { ...taskReviewChecklist, safeDestinations: false },
      reason: 'Remove the unsafe destination before proceeding',
    });
    const [updated] = await db
      .select()
      .from(schema.sponsorTasks)
      .where(eq(schema.sponsorTasks.id, row.id));
    assert.equal(updated!.reviewState, decision);
    assert.equal(await fundingBalance(db, row.allocationAccountId), 200n);
  }
});

test('audit insertion and status transition roll back together on caller failure', async () => {
  const { row } = await task();
  const reviewer = await account();
  await grant(reviewer);
  await assert.rejects(
    db.transaction(async (tx) => {
      await new TaskReviewService(tx).decide(reviewer, command(row));
      throw new Error('Synthetic failure');
    }),
  );
  assert.equal(
    (
      await db
        .select()
        .from(schema.taskReviews)
        .where(eq(schema.taskReviews.taskId, row.id))
    ).length,
    0,
  );
  assert.equal(
    (
      await db
        .select()
        .from(schema.sponsorTasks)
        .where(eq(schema.sponsorTasks.id, row.id))
    )[0]!.reviewState,
    'pending_review',
  );
});

test('database blocks direct approval, forged review inserts and audit rewrites', async () => {
  const { row, ownerId } = await task();
  await assert.rejects(
    db
      .update(schema.sponsorTasks)
      .set({ reviewState: 'approved' })
      .where(eq(schema.sponsorTasks.id, row.id)),
  );
  const reviewer = await account();
  const permission = await grant(reviewer);
  const raw = {
    ...command(row),
    reviewerId: ownerId,
    grantId: permission.id,
    requestHash: '0'.repeat(64),
  };
  await assert.rejects(db.insert(schema.taskReviews).values(raw));
  await assert.rejects(
    db.insert(schema.taskReviews).values({
      ...raw,
      reviewerId: reviewer,
      checklist: { ...taskReviewChecklist, fairRewardTerms: false },
    }),
  );
  const review = await service.decide(reviewer, command(row));
  await assert.rejects(
    db
      .update(schema.taskReviews)
      .set({ reason: 'Rewritten' })
      .where(eq(schema.taskReviews.id, review.id)),
  );
  await assert.rejects(
    db.delete(schema.taskReviews).where(eq(schema.taskReviews.id, review.id)),
  );
  await assert.rejects(db.execute(sql`truncate task_reviews`));
  await assert.rejects(
    db
      .update(schema.sponsorTasks)
      .set({ title: 'Changed after review' })
      .where(eq(schema.sponsorTasks.id, row.id)),
  );
});

test('permission grants cannot be extended, silently deleted or unrevoked', async () => {
  const reviewer = await account();
  const permission = await grant(reviewer);
  await assert.rejects(
    db
      .update(schema.taskReviewerGrants)
      .set({ expiresAt: new Date(Date.now() + 172800000) })
      .where(eq(schema.taskReviewerGrants.id, permission.id)),
  );
  await assert.rejects(
    db
      .delete(schema.taskReviewerGrants)
      .where(eq(schema.taskReviewerGrants.id, permission.id)),
  );
  await db
    .update(schema.taskReviewerGrants)
    .set({
      revokedAt: new Date(),
      revokedBy: permission.grantedBy,
      revocationReason: 'Test revocation',
    })
    .where(eq(schema.taskReviewerGrants.id, permission.id));
  await assert.rejects(
    db
      .update(schema.taskReviewerGrants)
      .set({ revokedAt: null, revokedBy: null, revocationReason: null })
      .where(eq(schema.taskReviewerGrants.id, permission.id)),
  );
});

test('review reads return exact JSON-safe money and bounded pages', async () => {
  const reviewer = await account();
  await grant(reviewer);
  const { row } = await task();
  const detail = await service.getPending(reviewer, row.id);
  assert.equal(detail.rewardKobo, '200');
  assert.equal(detail.budgetKobo, '200');
  assert.doesNotThrow(() => JSON.stringify(detail));
  const page = await service.listPending(reviewer, { limit: '1' });
  assert.equal(page.items.length, 1);
  if (page.nextCursor) {
    const next = await service.listPending(reviewer, {
      limit: '1',
      after: page.nextCursor,
    });
    assert.notEqual(page.items[0]!.id, next.items[0]?.id);
  }
  await assert.rejects(
    service.listPending(reviewer, { limit: '999' }),
    BadRequestException,
  );
  await assert.rejects(
    service.getPending(await account(), row.id),
    ForbiddenException,
  );
});
