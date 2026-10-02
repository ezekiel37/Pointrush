import { createHash, timingSafeEqual } from 'node:crypto';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { z } from 'zod';
import * as schema from '../database/schema.js';

type ProvisioningDatabase = PgDatabase<PgQueryResultHKT, typeof schema>;
type ProvisioningTransaction = Parameters<
  ProvisioningDatabase['transaction']
>[0] extends (tx: infer T) => unknown
  ? T
  : never;

const grantId = z.uuid();
const reason = z.string().trim().min(1).max(1000);

export interface ReviewerOperator {
  accountId: string;
  tokenHash: string;
}

export interface GrantReviewerInput {
  grantId: string;
  reviewerId: string;
  reason: string;
  expiresAt: Date;
}

export interface RevokeReviewerInput {
  grantId: string;
  reason: string;
}

function fail(message: string): never {
  throw new Error(message);
}

function assertTokenHash(value: string): string {
  if (!/^[a-f0-9]{64}$/.test(value)) fail('Operator token hash is invalid');
  return value;
}

export function authorizeReviewerOperator(
  operator: ReviewerOperator,
  presentedToken: string,
): void {
  const expected = Buffer.from(assertTokenHash(operator.tokenHash), 'hex');
  const actual = createHash('sha256').update(presentedToken).digest();
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual))
    fail('Reviewer provisioning authorization failed');
}

export function hashReviewerOperatorToken(token: string): string {
  if (!token || token.length < 32) fail('Operator token is too short');
  return createHash('sha256').update(token).digest('hex');
}

function validateGrantInput(input: GrantReviewerInput): GrantReviewerInput {
  const id = grantId.safeParse(input.grantId);
  if (!id.success) fail('Grant identifier is invalid');
  const reviewer = grantId.safeParse(input.reviewerId);
  if (!reviewer.success) fail('Reviewer identifier is invalid');
  const grantReason = reason.safeParse(input.reason);
  if (!grantReason.success) fail('Grant reason is invalid');
  if (!Number.isFinite(input.expiresAt.getTime()))
    fail('Grant expiry is invalid');
  if (input.expiresAt.getTime() <= Date.now())
    fail('Grant expiry must be in the future');
  return {
    grantId: id.data,
    reviewerId: reviewer.data,
    reason: grantReason.data,
    expiresAt: input.expiresAt,
  };
}

function validateRevokeInput(input: RevokeReviewerInput): RevokeReviewerInput {
  const id = grantId.safeParse(input.grantId);
  if (!id.success) fail('Grant identifier is invalid');
  const revokeReason = reason.safeParse(input.reason);
  if (!revokeReason.success) fail('Revocation reason is invalid');
  return { grantId: id.data, reason: revokeReason.data };
}

export class ReviewerProvisioningService {
  constructor(
    private readonly db: ProvisioningDatabase,
    private readonly maxGrantDurationMs: number,
  ) {
    if (!Number.isInteger(maxGrantDurationMs) || maxGrantDurationMs <= 0)
      throw new Error('Reviewer grant duration is invalid');
  }

  async grant(operatorId: string, input: GrantReviewerInput) {
    const value = validateGrantInput(input);
    if (value.expiresAt.getTime() - Date.now() > this.maxGrantDurationMs)
      fail('Grant expiry exceeds the allowed duration');
    return this.db.transaction(async (tx) => {
      const operator = await this.activeAccount(tx, operatorId, true);
      await this.activeAccount(tx, value.reviewerId, true);
      const [existing] = await tx
        .select()
        .from(schema.taskReviewerGrants)
        .where(eq(schema.taskReviewerGrants.id, value.grantId))
        .for('update');
      if (existing) {
        if (
          existing.reviewerId === value.reviewerId &&
          existing.grantedBy === operator.id &&
          existing.reason === value.reason &&
          existing.expiresAt.getTime() === value.expiresAt.getTime() &&
          existing.revokedAt === null
        )
          return existing;
        fail('Grant identifier is already bound to another operation');
      }
      const [unrevoked] = await tx
        .select({ id: schema.taskReviewerGrants.id })
        .from(schema.taskReviewerGrants)
        .where(
          and(
            eq(schema.taskReviewerGrants.reviewerId, value.reviewerId),
            isNull(schema.taskReviewerGrants.revokedAt),
          ),
        )
        .for('update');
      if (unrevoked) fail('Reviewer already has an unrevoked grant');
      const [created] = await tx
        .insert(schema.taskReviewerGrants)
        .values({
          id: value.grantId,
          reviewerId: value.reviewerId,
          grantedBy: operator.id,
          reason: value.reason,
          expiresAt: value.expiresAt,
        })
        .returning();
      if (!created) fail('Reviewer grant was not created');
      return created;
    });
  }

  async revoke(operatorId: string, input: RevokeReviewerInput) {
    const value = validateRevokeInput(input);
    return this.db.transaction(async (tx) => {
      const operator = await this.activeAccount(tx, operatorId, true);
      const [grant] = await tx
        .select()
        .from(schema.taskReviewerGrants)
        .where(eq(schema.taskReviewerGrants.id, value.grantId))
        .for('update');
      if (!grant) fail('Reviewer grant was not found');
      if (grant.revokedAt) {
        if (
          grant.revokedBy === operator.id &&
          grant.revocationReason === value.reason
        )
          return grant;
        fail('Reviewer grant was already revoked');
      }
      const [revoked] = await tx
        .update(schema.taskReviewerGrants)
        .set({
          revokedAt: sql`clock_timestamp()`,
          revokedBy: operator.id,
          revocationReason: value.reason,
        })
        .where(eq(schema.taskReviewerGrants.id, value.grantId))
        .returning();
      if (!revoked) fail('Reviewer grant was not revoked');
      return revoked;
    });
  }

  private async activeAccount(
    tx: ProvisioningTransaction,
    accountId: string,
    verified: boolean,
  ) {
    const [account] = await tx
      .select({
        id: schema.accounts.id,
        accessState: schema.accounts.accessState,
        emailVerified: schema.authUsers.emailVerified,
      })
      .from(schema.accounts)
      .leftJoin(
        schema.authAccountLinks,
        eq(schema.authAccountLinks.accountId, schema.accounts.id),
      )
      .leftJoin(
        schema.authUsers,
        eq(schema.authUsers.id, schema.authAccountLinks.authUserId),
      )
      .where(eq(schema.accounts.id, accountId));
    if (!account || account.accessState !== 'active')
      fail('Account is not active');
    if (verified && account.emailVerified !== true)
      fail('Reviewer email is not verified');
    return account;
  }
}
