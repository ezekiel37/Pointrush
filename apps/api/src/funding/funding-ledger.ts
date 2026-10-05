import { and, eq, sql } from 'drizzle-orm';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { z } from 'zod';
import type * as schema from '../database/schema.js';
import { fundingAccounts, fundingTransfers } from './funding.schema.js';

const command = z
  .object({
    id: z.uuid(),
    sourceId: z.uuid(),
    destinationId: z.uuid(),
    actorId: z.uuid(),
    amountKobo: z.bigint().positive().max(9223372036854775807n),
    kind: z.enum([
      'funding_confirmed',
      'task_lock',
      'task_reward',
      'purchase_cashback',
      'prize_claim',
      'payout_hold',
      'payout_paid',
      'payout_returned',
      'campaign_return',
    ]),
    reference: z.string().trim().min(1).max(200),
    reason: z.string().trim().min(1).max(500),
  })
  .strict();
export type FundingCommand = z.infer<typeof command>;
export type FundingDatabase = PgDatabase<PgQueryResultHKT, typeof schema>;

export class FundingConflict extends Error {
  constructor() {
    super('Funding command conflicts with an existing operation');
  }
}

// Internal persistence capability, not an authorization or payment-verification API.
// Accepts an existing Drizzle transaction so task creation can commit atomically.
export async function postFundingTransfer(
  db: FundingDatabase,
  input: FundingCommand,
) {
  const value = command.parse(input);
  return db.transaction(async (tx) => {
    // Serialize both replay identities before checking the journal. Hash collisions
    // only serialize unrelated work. Stable ordering avoids lock-order deadlocks.
    for (const key of [
      `funding:id:${value.id}`,
      `funding:reference:${value.kind}:${value.reference}`,
    ].sort()) {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`,
      );
    }
    const [byId] = await tx
      .select()
      .from(fundingTransfers)
      .where(eq(fundingTransfers.id, value.id));
    const [byReference] = await tx
      .select()
      .from(fundingTransfers)
      .where(
        and(
          eq(fundingTransfers.kind, value.kind),
          eq(fundingTransfers.reference, value.reference),
        ),
      );
    const existing = byId ?? byReference;
    if (existing) {
      // A provider replay may have a fresh command UUID; the durable reference
      // still identifies one economic event. All other fields must match.
      if (
        (byId && byReference && byId.id !== byReference.id) ||
        Object.entries(value).some(
          ([key, item]) =>
            key !== 'id' && existing[key as keyof typeof existing] !== item,
        )
      )
        throw new FundingConflict();
      return existing;
    }
    const [entry] = await tx.insert(fundingTransfers).values(value).returning();
    return entry!;
  });
}

export async function fundingBalance(
  db: FundingDatabase,
  accountId: string,
): Promise<bigint> {
  const id = z.uuid().parse(accountId);
  const [account] = await db
    .select({ id: fundingAccounts.id })
    .from(fundingAccounts)
    .where(eq(fundingAccounts.id, id));
  if (!account) throw new Error('Funding account not found');
  const [result] = await db
    .select({
      balance: sql<string>`coalesce(sum(case when ${fundingTransfers.destinationId} = ${id} then ${fundingTransfers.amountKobo} else -${fundingTransfers.amountKobo} end), 0)::text`,
    })
    .from(fundingTransfers)
    .where(
      sql`${fundingTransfers.sourceId} = ${id} or ${fundingTransfers.destinationId} = ${id}`,
    );
  return BigInt(result!.balance);
}
