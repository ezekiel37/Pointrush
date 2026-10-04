import { ConflictException, ForbiddenException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import type { FundingDatabase } from '../funding/funding-ledger.js';
import * as s from '../database/schema.js';

// Database rule violations raised by PointRush triggers. Their messages are stable
// product reasons; constraint names and other driver detail are never returned.
const reasons: Record<string, string> = {
  'Campaign is full': 'campaign_full',
  'Shopper daily purchase limit reached': 'daily_limit',
  'Too many purchase codes requested': 'code_rate_limit',
  'Offer unavailable': 'offer_unavailable',
  'Purchase cannot be confirmed': 'confirmation_rejected',
  'Purchase cannot be voided': 'void_rejected',
  'Cash back is not releasable': 'not_releasable',
};

function databaseError(error: unknown) {
  const cause = error instanceof Error ? error.cause : undefined;
  const detail = (cause ?? error) as { code?: string; message?: string };
  return { code: detail?.code, message: detail?.message };
}

// Resolves the session to an active, verified account inside the command
// transaction, so access cannot change between the check and the write.
export async function actorTransaction<T>(
  db: FundingDatabase,
  authUserId: string,
  action: (tx: FundingDatabase, actor: string) => Promise<T>,
) {
  try {
    return await db.transaction(async (tx) => {
      const [actor] = await tx
        .select({ id: s.accounts.id })
        .from(s.accounts)
        .innerJoin(
          s.authAccountLinks,
          eq(s.authAccountLinks.accountId, s.accounts.id),
        )
        .innerJoin(
          s.authUsers,
          eq(s.authUsers.id, s.authAccountLinks.authUserId),
        )
        .where(
          and(
            eq(s.authUsers.id, authUserId),
            eq(s.authUsers.emailVerified, true),
            eq(s.accounts.accessState, 'active'),
          ),
        )
        .for('share', { of: s.accounts });
      if (!actor)
        throw new ForbiddenException('Active linked account required');
      return action(tx, actor.id);
    });
  } catch (error) {
    const { code, message } = databaseError(error);
    if (['23514', '23505', '23503'].includes(code ?? ''))
      throw new ConflictException({
        statusCode: 409,
        message:
          'Task state changed or command is not eligible; reload current details',
        reason: (message && reasons[message]) ?? 'not_eligible',
      });
    throw error;
  }
}
