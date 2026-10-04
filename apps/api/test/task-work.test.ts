import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { before, after, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { eq, sql } from 'drizzle-orm';
import * as s from '../src/database/schema.js';
import { assertReviewerEnrollment } from '../src/auth/admin-mfa.js';
import { TaskQueriesService } from '../src/tasks/task-queries.service.js';
import { TaskWorkService } from '../src/tasks/task-work.service.js';
import { SponsorsService } from '../src/sponsors/sponsors.service.js';
import { TaskReviewService } from '../src/reviews/task-review.service.js';
import { taskReviewChecklist } from '../src/reviews/task-review.schema.js';
import {
  postFundingTransfer,
  fundingBalance,
} from '../src/funding/funding-ledger.js';

const pg = new PGlite();
const db = drizzle(pg, { schema: s });
const work = new TaskWorkService(db);
let clearing: string;
let reviewer: string;
before(async () => {
  await migrate(db, { migrationsFolder: resolve('migrations') });
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
async function task(terms = true, durationMs = 3600000) {
  const sponsor = await identity();
  const sponsors = new SponsorsService({ db }, 'test');
  await sponsors.createProfile(sponsor.user, {
    name: 'Synthetic business',
    termsVersion: 'test',
    acceptTerms: true,
  });
  const available = (
    await db
      .select()
      .from(s.fundingAccounts)
      .where(eq(s.fundingAccounts.ownerId, sponsor.account))
  )[0]!;
  await postFundingTransfer(db, {
    id: randomUUID(),
    sourceId: clearing,
    destinationId: available.id,
    amountKobo: 200n,
    actorId: sponsor.account,
    kind: 'funding_confirmed',
    reference: randomUUID(),
    reason: 'Synthetic funding',
  });
  const start = new Date(Date.now() + 400);
  const created = await sponsors.createTask(sponsor.user, {
    requestId: randomUUID(),
    title: 'Original guide',
    instructions: 'Write guide',
    proofRequirements: 'Text evidence',
    rejectionCriteria: 'Plagiarism',
    model: 'capped_fixed',
    capacity: 1,
    rewardKobo: '200',
    startsAt: start.toISOString(),
    endsAt: new Date(start.getTime() + durationMs).toISOString(),
    ...(terms
      ? {
          workTerms: {
            reviewHours: 72,
            correctionHours: 48,
            appealHours: 168,
            settlement: 'approved_reward_backing',
          },
        }
      : {}),
  });
  await assert.rejects(work.publish(sponsor.user, created.id));
  const row = (
    await db
      .select()
      .from(s.sponsorTasks)
      .where(eq(s.sponsorTasks.id, created.id))
  )[0]!;
  await new TaskReviewService(db).decide(reviewer, {
    taskId: row.id,
    requestId: randomUUID(),
    termsVersion: row.termsVersion,
    termsHash: row.requestHash,
    decision: 'approved',
    reason: 'Synthetic approved brief',
    checklist: { ...taskReviewChecklist },
  });
  if (terms) {
    await work.publish(sponsor.user, created.id);
    await new Promise((r) =>
      setTimeout(r, Math.max(0, start.getTime() - Date.now() + 10)),
    );
  }
  return { sponsor, created };
}
const proof = () => ({
  id: randomUUID(),
  revision: 1,
  evidence: 'Original evidence text',
});
const decision = (state: 'approved' | 'rejected' | 'changes_required') => ({
  id: randomUUID(),
  decision: state,
  reason: 'Reason tied to the accepted brief',
});

test('publication requires review and complete terms; legacy tasks remain private', async () => {
  const { sponsor, created } = await task(false);
  await assert.rejects(work.publish(sponsor.user, created.id));
  await assert.rejects(work.readTask((await identity()).user, created.id));
  assert.equal(await fundingBalance(db, created.allocationAccountId), 200n);
});

test('published task -> one claim -> proof -> approval credits backing exactly once', async () => {
  const { sponsor, created } = await task();
  const user = await identity();
  const other = await identity();
  const publicTask = await work.readTask(user.user, created.id);
  assert.equal(publicTask.rewardBackingKobo, '200');
  assert.equal(publicTask.workTerms?.appealHours, 168);
  assert.equal(
    (await work.publish(sponsor.user, created.id)).taskId,
    created.id,
  );
  await assert.rejects(work.join(sponsor.user, created.id));
  const claim = await work.join(user.user, created.id);
  assert.equal((await work.join(user.user, created.id)).id, claim.id);
  await assert.rejects(work.join(other.user, created.id));
  await assert.rejects(work.submit(other.user, claim.id, proof()));
  const input = proof();
  const submitted = await work.submit(user.user, claim.id, input);
  assert.equal(
    (await work.submit(user.user, claim.id, input)).id,
    submitted.id,
  );
  await assert.rejects(
    work.submit(user.user, claim.id, {
      ...input,
      evidence: 'Changed evidence',
    }),
  );
  await assert.rejects(
    work.decide(other.user, submitted.id, decision('approved')),
  );
  const approved = decision('approved');
  await work.decide(sponsor.user, submitted.id, approved);
  await work.decide(sponsor.user, submitted.id, approved);
  await assert.rejects(
    work.decide(sponsor.user, submitted.id, decision('approved')),
  );
  const wallet = (
    await db
      .select()
      .from(s.fundingAccounts)
      .where(eq(s.fundingAccounts.ownerId, user.account))
  )[0]!;
  assert.equal(await fundingBalance(db, wallet.id), 200n);
  assert.equal(await fundingBalance(db, created.allocationAccountId), 0n);
  const view = await work.readClaim(user.user, claim.id);
  assert.equal(view.proofs[0]?.decision?.decision, 'approved');
  assert.equal(view.participant, true);
  assert.ok(view.task.proofRequirements);
  assert.ok(Number.isFinite(Date.parse(view.observedAt)));
  const sponsorView = await work.readClaim(sponsor.user, claim.id);
  assert.equal(sponsorView.participant, false);
  await assert.rejects(work.readClaim(other.user, claim.id));
});

test('correction protects funding; independent authorized appeal can credit once', async () => {
  const { sponsor, created } = await task();
  const user = await identity();
  const arbiter = await identity();
  const claim = await work.join(user.user, created.id);
  const first = await work.submit(user.user, claim.id, proof());
  await assert.rejects(work.acknowledge(user.user, first.id));
  await work.decide(sponsor.user, first.id, decision('changes_required'));
  await assert.rejects(work.acknowledge(sponsor.user, first.id));
  const receipt = await work.acknowledge(user.user, first.id);
  assert.equal(
    (await work.acknowledge(user.user, first.id)).createdAt.getTime(),
    receipt.createdAt.getTime(),
  );
  assert.equal(await fundingBalance(db, created.allocationAccountId), 200n);
  const second = await work.submit(user.user, claim.id, {
    ...proof(),
    revision: 2,
  });
  await assert.rejects(
    work.decide(sponsor.user, second.id, decision('changes_required')),
  );
  await work.decide(sponsor.user, second.id, decision('rejected'));
  assert.equal(await fundingBalance(db, created.allocationAccountId), 200n);
  const appeal = await work.appeal(user.user, second.id, {
    id: randomUUID(),
    reason: 'Original submission satisfies the brief',
  });
  const input = {
    id: randomUUID(),
    decision: 'approved',
    reason: 'Evidence satisfies accepted requirements',
  };
  const queries = new TaskQueriesService(db);
  await assert.rejects(queries.appeals(arbiter.user));
  await assert.rejects(work.resolve(arbiter.user, appeal.id, input));
  for (const who of [arbiter, sponsor, user])
    await db.insert(s.appealReviewerGrants).values({
      accountId: who.account,
      grantedBy: reviewer,
      reason: 'Synthetic arbitration appointment',
      expiresAt: new Date(Date.now() + 3600000),
    });
  await assert.rejects(work.resolve(sponsor.user, appeal.id, input));
  await assert.rejects(work.resolve(user.user, appeal.id, input));
  await assertReviewerEnrollment(db, arbiter.user);
  const queued = await queries.appeals(arbiter.user, { limit: '1' });
  assert.equal(queued.items[0]?.id, appeal.id);
  assert.equal(
    (await queries.appeals(arbiter.user, { after: appeal.id })).items.length,
    0,
  );
  assert.equal(
    (await queries.appeals(sponsor.user)).items.some(
      (row) => row.id === appeal.id,
    ),
    false,
  );
  assert.equal(
    (await queries.appeals(user.user)).items.some(
      (row) => row.id === appeal.id,
    ),
    false,
  );
  await assert.rejects(queries.appeals(arbiter.user, { limit: '51' }));
  await assert.rejects(
    queries.appeals(arbiter.user, { accountId: user.account }),
  );
  const arbitration = await work.readAppeal(arbiter.user, appeal.id);
  assert.equal(arbitration.resolution, null);
  assert.equal(arbitration.history.length, 2);
  assert.doesNotThrow(() => JSON.stringify(arbitration));
  await assert.rejects(work.readAppeal(sponsor.user, appeal.id));
  await work.resolve(arbiter.user, appeal.id, input);
  await work.resolve(arbiter.user, appeal.id, input);
  assert.equal(
    (await queries.appeals(arbiter.user)).items.some(
      (row) => row.id === appeal.id,
    ),
    false,
  );
  assert.equal(
    (await work.readAppeal(arbiter.user, appeal.id)).resolution?.decision,
    'approved',
  );
  await db
    .update(s.appealReviewerGrants)
    .set({ revokedAt: new Date() })
    .where(eq(s.appealReviewerGrants.accountId, arbiter.account));
  await assert.rejects(queries.appeals(arbiter.user));
  assert.equal(await fundingBalance(db, created.allocationAccountId), 0n);
  await assert.rejects(
    work.resolve(arbiter.user, appeal.id, { ...input, id: randomUUID() }),
  );
});

test('approval and financial postings roll back together; history and journal cannot be forged', async () => {
  const { sponsor, created } = await task();
  const user = await identity();
  const claim = await work.join(user.user, created.id);
  const submitted = await work.submit(user.user, claim.id, proof());
  const approved = decision('approved');
  await assert.rejects(
    db.transaction(async (tx) => {
      await new TaskWorkService(tx).decide(
        sponsor.user,
        submitted.id,
        approved,
      );
      throw new Error('Force rollback');
    }),
  );
  assert.equal(
    (
      await db
        .select()
        .from(s.proofDecisions)
        .where(eq(s.proofDecisions.id, approved.id))
    ).length,
    0,
  );
  assert.equal(await fundingBalance(db, created.allocationAccountId), 200n);
  await assert.rejects(
    db.execute(
      sql`UPDATE task_proofs SET evidence='tampered' WHERE id=${submitted.id}`,
    ),
  );
  const [wallet] = await db
    .insert(s.fundingAccounts)
    .values({ ownerId: user.account, bucket: 'reward_wallet' })
    .returning();
  await assert.rejects(
    postFundingTransfer(db, {
      id: randomUUID(),
      sourceId: created.allocationAccountId,
      destinationId: wallet!.id,
      amountKobo: 200n,
      actorId: sponsor.account,
      kind: 'task_reward',
      reference: `claim:${claim.id}`,
      reason: 'Unapproved forged credit',
    }),
  );
  await work.decide(sponsor.user, submitted.id, approved);
  assert.equal(await fundingBalance(db, wallet!.id), 200n);
});

test('ended tasks reject new claims and late first proofs without releasing protected backing', async () => {
  const { created } = await task(true, 300);
  const user = await identity();
  const other = await identity();
  const claim = await work.join(user.user, created.id);
  await new Promise((resolve) =>
    setTimeout(
      resolve,
      Math.max(0, new Date(created.endsAt).getTime() - Date.now() + 10),
    ),
  );
  await assert.rejects(work.join(other.user, created.id));
  await assert.rejects(work.submit(user.user, claim.id, proof()));
  assert.equal((await work.join(user.user, created.id)).id, claim.id);
  assert.equal(await fundingBalance(db, created.allocationAccountId), 200n);
});

test('discovery and work lists are bounded, searchable and isolated by session identity', async () => {
  const queries = new TaskQueriesService(db);
  const { sponsor, created } = await task();
  const user = await identity();
  const outsider = await identity();
  const claim = await work.join(user.user, created.id);
  const result = await queries.discover(user.user, {
    limit: '1',
    q: 'Original',
  });
  assert.equal(result.items.length, 1);
  assert.doesNotThrow(() => JSON.stringify(result));
  if (result.nextCursor) {
    const next = await queries.discover(user.user, {
      limit: '1',
      q: 'Original',
      after: result.nextCursor,
    });
    assert.notEqual(result.items[0]!.id, next.items[0]?.id);
  }
  assert.equal((await queries.discover(user.user, { q: '%' })).items.length, 0);
  await assert.rejects(queries.discover(user.user, { limit: '51' }));
  await assert.rejects(
    queries.mine(user.user, { accountId: outsider.account }),
  );
  const mine = await queries.mine(user.user);
  assert.equal(mine.items[0]!.id, claim.id);
  assert.equal(mine.items[0]!.approvedBackingKobo, '0');
  assert.equal((await queries.mine(outsider.user)).items.length, 0);
  assert.equal(
    (await queries.sponsorTasks(sponsor.user)).items[0]!.id,
    created.id,
  );
  assert.equal((await queries.sponsorTasks(outsider.user)).items.length, 0);
  assert.equal(
    (await queries.participants(sponsor.user, created.id)).items[0]!.id,
    claim.id,
  );
  await assert.rejects(queries.participants(outsider.user, created.id));
  const submitted = await work.submit(user.user, claim.id, proof());
  assert.equal(
    (await queries.mine(user.user)).items[0]!.latestProofId,
    submitted.id,
  );
  await work.decide(sponsor.user, submitted.id, decision('approved'));
  assert.equal(
    (await queries.mine(user.user)).items[0]!.approvedBackingKobo,
    '200',
  );
});
