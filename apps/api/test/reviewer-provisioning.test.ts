import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { after, before, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { eq } from 'drizzle-orm';
import * as schema from '../src/database/schema.js';
import {
  authorizeReviewerOperator,
  hashReviewerOperatorToken,
  ReviewerProvisioningService,
} from '../src/reviews/reviewer-provisioning.js';

const pg = new PGlite();
const db = drizzle(pg, { schema });
const service = new ReviewerProvisioningService(
  db as never,
  30 * 24 * 60 * 60 * 1000,
);
const token = 'synthetic-reviewer-operator-token-1234567890';
let operatorId: string;
let reviewerId: string;

before(async () => {
  await migrate(db, { migrationsFolder: resolve('migrations') });
  operatorId = (await identity('operator@example.test')).accountId;
  reviewerId = (await identity('reviewer@example.test')).accountId;
});
after(async () => {
  await pg.close();
});

async function identity(
  email: string,
): Promise<{ accountId: string; userId: string }> {
  const userId = randomUUID();
  await db.insert(schema.authUsers).values({
    id: userId,
    email,
    name: email,
    emailVerified: true,
  });
  const [account] = await db.insert(schema.accounts).values({}).returning();
  assert.ok(account);
  await db.insert(schema.authAccountLinks).values({
    accountId: account.id,
    authUserId: userId,
  });
  return { accountId: account.id, userId };
}

test('operator token binding fails closed and never accepts a raw account ID as proof', () => {
  const hash = hashReviewerOperatorToken(token);
  authorizeReviewerOperator({ accountId: operatorId, tokenHash: hash }, token);
  assert.throws(
    () =>
      authorizeReviewerOperator(
        { accountId: operatorId, tokenHash: hash },
        'wrong-token',
      ),
    /authorization failed/,
  );
  assert.throws(
    () =>
      authorizeReviewerOperator(
        { accountId: operatorId, tokenHash: operatorId },
        token,
      ),
    /token hash is invalid/,
  );
});

test('grant is bounded, reviewer-bound and exactly retryable', async () => {
  const id = randomUUID();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const input = {
    grantId: id,
    reviewerId,
    reason: 'Synthetic appointment',
    expiresAt,
  };
  const created = await service.grant(operatorId, input);
  assert.equal(created.id, id);
  assert.equal((await service.grant(operatorId, input)).id, id);
  // A reviewer can also decide job appeals, for the same period, once.
  const appeals = await db
    .select()
    .from(schema.appealReviewerGrants)
    .where(eq(schema.appealReviewerGrants.accountId, reviewerId));
  assert.equal(appeals.length, 1);
  assert.equal(appeals[0]!.expiresAt.getTime(), expiresAt.getTime());
  assert.equal(appeals[0]!.grantedBy, operatorId);
  await assert.rejects(
    service.grant(operatorId, { ...input, reason: 'Changed operation' }),
    /already bound/,
  );
  await assert.rejects(
    service.grant(operatorId, {
      grantId: randomUUID(),
      reviewerId,
      reason: 'Second appointment',
      expiresAt,
    }),
    /already has an unrevoked grant/,
  );
  await assert.rejects(
    service.grant(operatorId, {
      grantId: randomUUID(),
      reviewerId: operatorId,
      reason: 'Too far',
      expiresAt: new Date(Date.now() + 31 * 24 * 60 * 60 * 1000),
    }),
    /exceeds the allowed duration/,
  );
});

test('preview validates without writing', async () => {
  const previewReviewer = (await identity('preview@example.test')).accountId;
  const id = randomUUID();
  const input = {
    grantId: id,
    reviewerId: previewReviewer,
    reason: 'Preview appointment',
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
  };
  const before = (await db.select().from(schema.taskReviewerGrants)).length;
  assert.deepEqual(await service.previewGrant(operatorId, input), {
    operation: 'grant',
    status: 'ready',
    grantId: id,
    reviewerId: previewReviewer,
  });
  assert.equal(
    (await db.select().from(schema.taskReviewerGrants)).length,
    before,
  );
  const created = await service.grant(operatorId, input);
  assert.deepEqual(
    await service.previewRevoke(operatorId, {
      grantId: id,
      reason: 'Preview revocation',
    }),
    {
      operation: 'revoke',
      status: 'ready',
      grantId: id,
      reviewerId: previewReviewer,
    },
  );
  assert.equal(
    (await db.select().from(schema.taskReviewerGrants)).find(
      (grant) => grant.id === created.id,
    )?.revokedAt,
    null,
  );
});

test('revoke is immutable and exactly retryable', async () => {
  const id = randomUUID();
  await service.grant(operatorId, {
    grantId: id,
    reviewerId: operatorId,
    reason: 'Second synthetic operator appointment',
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
  });
  const revoked = await service.revoke(operatorId, {
    grantId: id,
    reason: 'Appointment ended',
  });
  assert.equal(revoked.revocationReason, 'Appointment ended');
  // Appeal permission ends with it.
  const appeals = await db
    .select()
    .from(schema.appealReviewerGrants)
    .where(eq(schema.appealReviewerGrants.accountId, operatorId));
  assert.ok(appeals.length > 0);
  assert.ok(appeals.every((a) => a.revokedAt !== null));
  assert.equal(
    (
      await service.revoke(operatorId, {
        grantId: id,
        reason: 'Appointment ended',
      })
    ).id,
    id,
  );
  await assert.rejects(
    service.revoke(operatorId, { grantId: id, reason: 'Different reason' }),
    /already revoked/,
  );
});

test('unverified or inactive identities cannot provision reviewers', async () => {
  const unverified = await identity('unverified@example.test');
  await db
    .update(schema.authUsers)
    .set({ emailVerified: false })
    .where(eq(schema.authUsers.id, unverified.userId));
  await assert.rejects(
    service.grant(operatorId, {
      grantId: randomUUID(),
      reviewerId: unverified.accountId,
      reason: 'Unverified appointment',
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    }),
    /email is not verified/,
  );
  const inactive = await identity('inactive@example.test');
  await db
    .update(schema.accounts)
    .set({ accessState: 'suspended' })
    .where(eq(schema.accounts.id, inactive.accountId));
  await assert.rejects(
    service.grant(operatorId, {
      grantId: randomUUID(),
      reviewerId: inactive.accountId,
      reason: 'Inactive appointment',
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    }),
    /Account is not active/,
  );
});
