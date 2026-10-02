import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import * as schema from '../database/schema.js';

type RecoveryDatabase = PgDatabase<PgQueryResultHKT, typeof schema>;

const inputSchema = z.object({
  requestId: z.uuid(),
  operatorAccountId: z.uuid(),
  targetAuthUserId: z.string().trim().min(1).max(128),
  reason: z.string().trim().min(1).max(1000),
  evidenceRef: z.string().trim().min(1).max(500).optional(),
});

export type MfaRecoveryInput = z.infer<typeof inputSchema>;

export class MfaRecoveryService {
  constructor(private readonly db: RecoveryDatabase) {}

  async resetFactor(input: MfaRecoveryInput) {
    const value = inputSchema.parse(input);
    return this.db.transaction(async (tx) => {
      const [operator] = await tx
        .select({
          id: schema.accounts.id,
          accessState: schema.accounts.accessState,
          emailVerified: schema.authUsers.emailVerified,
        })
        .from(schema.accounts)
        .innerJoin(
          schema.authAccountLinks,
          eq(schema.authAccountLinks.accountId, schema.accounts.id),
        )
        .innerJoin(
          schema.authUsers,
          eq(schema.authUsers.id, schema.authAccountLinks.authUserId),
        )
        .where(eq(schema.accounts.id, value.operatorAccountId))
        .for('update');
      if (
        !operator ||
        operator.accessState !== 'active' ||
        !operator.emailVerified
      )
        throw new Error('Recovery operator is not active and verified');

      const [existing] = await tx
        .select()
        .from(schema.authMfaRecoveryEvents)
        .where(eq(schema.authMfaRecoveryEvents.requestId, value.requestId))
        .for('share');
      if (existing) {
        if (
          existing.operatorAccountId === value.operatorAccountId &&
          existing.targetAuthUserId === value.targetAuthUserId &&
          existing.reason === value.reason &&
          existing.evidenceRef === (value.evidenceRef ?? null)
        )
          return existing;
        throw new Error('Recovery request identifier is already bound');
      }

      const [target] = await tx
        .select({ id: schema.authUsers.id })
        .from(schema.authUsers)
        .where(eq(schema.authUsers.id, value.targetAuthUserId))
        .for('update');
      if (!target) throw new Error('Target authentication user was not found');

      const [factor] = await tx
        .select({ id: schema.authTwoFactors.id })
        .from(schema.authTwoFactors)
        .where(eq(schema.authTwoFactors.userId, value.targetAuthUserId))
        .for('update');
      if (factor)
        await tx
          .delete(schema.authTwoFactors)
          .where(eq(schema.authTwoFactors.id, factor.id));

      await tx
        .update(schema.authUsers)
        .set({ twoFactorEnabled: false, updatedAt: sql`clock_timestamp()` })
        .where(eq(schema.authUsers.id, value.targetAuthUserId));
      // Recovery invalidates every old browser and every old admin-MFA proof.
      await tx
        .delete(schema.authSessions)
        .where(eq(schema.authSessions.userId, value.targetAuthUserId));

      const [event] = await tx
        .insert(schema.authMfaRecoveryEvents)
        .values({
          requestId: value.requestId,
          operatorAccountId: value.operatorAccountId,
          targetAuthUserId: value.targetAuthUserId,
          previousFactorId: factor?.id,
          reason: value.reason,
          evidenceRef: value.evidenceRef,
        })
        .returning();
      if (!event) throw new Error('Recovery audit event was not created');
      return event;
    });
  }
}
