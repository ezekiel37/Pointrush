import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { accounts } from '../database/schema.js';

export const fundingAccounts = pgTable(
  'funding_accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: uuid('owner_id').references(() => accounts.id, {
      onDelete: 'restrict',
    }),
    bucket: text('bucket').notNull(),
    allocationId: uuid('allocation_id'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check(
      'funding_account_shape',
      sql`(${t.bucket} = 'clearing' and ${t.ownerId} is null and ${t.allocationId} is null) or (${t.bucket} in ('available', 'reward_wallet', 'payout_hold') and ${t.ownerId} is not null and ${t.allocationId} is null) or (${t.bucket} = 'task_locked' and ${t.ownerId} is not null and ${t.allocationId} is not null)`,
    ),
    uniqueIndex('funding_clearing_unique')
      .on(t.bucket)
      .where(sql`${t.bucket} = 'clearing'`),
    uniqueIndex('funding_available_unique')
      .on(t.ownerId)
      .where(sql`${t.bucket} = 'available'`),
    uniqueIndex('funding_reward_wallet_unique')
      .on(t.ownerId)
      .where(sql`${t.bucket} = 'reward_wallet'`),
    uniqueIndex('funding_payout_hold_unique')
      .on(t.ownerId)
      .where(sql`${t.bucket} = 'payout_hold'`),
    uniqueIndex('funding_allocation_unique')
      .on(t.allocationId)
      .where(sql`${t.bucket} = 'task_locked'`),
  ],
);

// Each immutable transfer represents two equal, opposite ledger postings.
// There is no independently editable balance column.
export const fundingTransfers = pgTable(
  'funding_transfers',
  {
    id: uuid('id').primaryKey(),
    sourceId: uuid('source_id')
      .notNull()
      .references(() => fundingAccounts.id),
    destinationId: uuid('destination_id')
      .notNull()
      .references(() => fundingAccounts.id),
    amountKobo: bigint('amount_kobo', { mode: 'bigint' }).notNull(),
    currency: text('currency').notNull().default('NGN'),
    kind: text('kind').notNull(),
    reference: varchar('reference', { length: 200 }).notNull(),
    actorId: uuid('actor_id')
      .notNull()
      .references(() => accounts.id),
    reason: varchar('reason', { length: 500 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check('funding_amount_positive', sql`${t.amountKobo} > 0`),
    check('funding_currency_ngn', sql`${t.currency} = 'NGN'`),
    check(
      'funding_distinct_accounts',
      sql`${t.sourceId} <> ${t.destinationId}`,
    ),
    check(
      'funding_transfer_kind',
      sql`${t.kind} in ('funding_confirmed', 'task_lock', 'task_reward', 'purchase_cashback', 'prize_claim', 'payout_hold', 'payout_paid', 'payout_returned', 'campaign_return', 'prize_handover', 'prize_cash_value', 'void_reversal')`,
    ),
    check('funding_reference_present', sql`length(btrim(${t.reference})) > 0`),
    check('funding_reason_present', sql`length(btrim(${t.reason})) > 0`),
    uniqueIndex('funding_reference_unique').on(t.kind, t.reference),
    index('funding_source_index').on(t.sourceId),
    index('funding_destination_index').on(t.destinationId),
  ],
);
