import { createHmac } from 'node:crypto';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { APIError } from 'better-auth/api';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import type * as schema from '../database/schema.js';
import {
  accounts,
  authAccountLinks,
  taskReviewerGrants,
} from '../database/schema.js';
import {
  authMfaCodes,
  authMfaSessions,
  authSessions,
  authTwoFactors,
  authUsers,
} from './auth.schema.js';

const denied = () =>
  new APIError('FORBIDDEN', {
    message: 'Recent authenticator verification is required',
  });

type AuthDatabase = PgDatabase<PgQueryResultHKT, typeof schema>;

export async function hasRecentAdminMfa(
  db: AuthDatabase,
  sessionId: string,
  userId: string,
): Promise<boolean> {
  const [proof] = await db
    .select({ id: authMfaSessions.sessionId })
    .from(authMfaSessions)
    .innerJoin(authSessions, eq(authSessions.id, authMfaSessions.sessionId))
    .innerJoin(authTwoFactors, eq(authTwoFactors.id, authMfaSessions.factorId))
    .innerJoin(authUsers, eq(authUsers.id, authSessions.userId))
    .where(
      and(
        eq(authSessions.id, sessionId),
        eq(authSessions.userId, userId),
        eq(authTwoFactors.userId, userId),
        eq(authTwoFactors.verified, true),
        eq(authUsers.twoFactorEnabled, true),
        sql`${authSessions.expiresAt} > clock_timestamp()`,
        sql`${authMfaSessions.verifiedAt} <= clock_timestamp()`,
        sql`${authMfaSessions.verifiedAt} > clock_timestamp() - interval '15 minutes'`,
      ),
    );
  return Boolean(proof);
}

export async function assertReviewerEnrollment(
  db: AuthDatabase,
  userId: string,
) {
  const [grant] = await db
    .select({ id: taskReviewerGrants.id })
    .from(taskReviewerGrants)
    .innerJoin(accounts, eq(accounts.id, taskReviewerGrants.reviewerId))
    .innerJoin(authAccountLinks, eq(authAccountLinks.accountId, accounts.id))
    .innerJoin(authUsers, eq(authUsers.id, authAccountLinks.authUserId))
    .where(
      and(
        eq(authUsers.id, userId),
        eq(authUsers.emailVerified, true),
        eq(accounts.accessState, 'active'),
        isNull(taskReviewerGrants.revokedAt),
        sql`${taskReviewerGrants.expiresAt} > clock_timestamp()`,
      ),
    );
  if (!grant)
    throw new APIError('FORBIDDEN', {
      message: 'Reviewer enrollment permission required',
    });
}

// Called only after Better Auth successfully verifies an authenticator code.
export async function recordAdminMfa(
  db: AuthDatabase,
  secret: string,
  sessionId: string,
  userId: string,
  code: string,
) {
  await db.transaction(async (tx) => {
    const [factor] = await tx
      .select()
      .from(authTwoFactors)
      .where(
        and(
          eq(authTwoFactors.userId, userId),
          eq(authTwoFactors.verified, true),
        ),
      )
      .for('update');
    if (!factor) throw denied();
    const [session] = await tx
      .select({ id: authSessions.id })
      .from(authSessions)
      .where(
        and(
          eq(authSessions.id, sessionId),
          eq(authSessions.userId, userId),
          sql`${authSessions.expiresAt} > clock_timestamp()`,
        ),
      )
      .for('share');
    if (!session) throw denied();
    const id = createHmac('sha256', secret)
      .update(`${factor.id}:${code}`)
      .digest('hex');
    const used = await tx
      .insert(authMfaCodes)
      .values({ id, factorId: factor.id })
      .onConflictDoUpdate({
        target: authMfaCodes.id,
        set: { usedAt: sql`clock_timestamp()` },
        setWhere: sql`${authMfaCodes.usedAt} < clock_timestamp() - interval '2 minutes'`,
      })
      .returning({ id: authMfaCodes.id });
    if (!used.length)
      throw new APIError('FORBIDDEN', {
        message: 'Wait for a new authenticator code',
      });
    await tx
      .insert(authMfaSessions)
      .values({
        sessionId,
        factorId: factor.id,
        verifiedAt: sql`clock_timestamp()`,
      })
      .onConflictDoUpdate({
        target: authMfaSessions.sessionId,
        set: { factorId: factor.id, verifiedAt: sql`clock_timestamp()` },
      });
    await tx
      .delete(authMfaCodes)
      .where(
        and(
          eq(authMfaCodes.factorId, factor.id),
          sql`${authMfaCodes.usedAt} < clock_timestamp() - interval '2 minutes'`,
        ),
      );
  });
}
