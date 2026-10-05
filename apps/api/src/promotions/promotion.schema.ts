import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { accounts } from '../database/schema.js';
import { sponsorTasks } from '../sponsors/sponsor.schema.js';

const at = (name: string) => timestamp(name, { withTimezone: true });

// A printed batch. Its codes are shown to the business once, at creation.
export const claimCodeBatches = pgTable(
  'claim_code_batches',
  {
    id: uuid('id').primaryKey(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => sponsorTasks.id),
    actorId: uuid('actor_id')
      .notNull()
      .references(() => accounts.id),
    size: integer('size').notNull(),
    label: varchar('label', { length: 80 }).notNull(),
    createdAt: at('created_at').notNull().defaultNow(),
  },
  (t) => [
    check('claim_batch_size', sql`${t.size} between 1 and 5000`),
    index('claim_batch_task').on(t.taskId),
  ],
);

// Only a SHA-256 fingerprint of each 16-character code is stored.
export const claimCodes = pgTable(
  'claim_codes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    batchId: uuid('batch_id')
      .notNull()
      .references(() => claimCodeBatches.id),
    taskId: uuid('task_id')
      .notNull()
      .references(() => sponsorTasks.id),
    codeHash: varchar('code_hash', { length: 64 }).notNull(),
  },
  (t) => [
    uniqueIndex('claim_code_hash').on(t.codeHash),
    index('claim_code_batch').on(t.batchId),
    check('claim_code_hash_format', sql`${t.codeHash} ~ '^[0-9a-f]{64}$'`),
  ],
);

// Codes cannot be claimed until the business says the batch is distributed.
export const claimBatchActivations = pgTable('claim_batch_activations', {
  batchId: uuid('batch_id')
    .primaryKey()
    .references(() => claimCodeBatches.id),
  actorId: uuid('actor_id')
    .notNull()
    .references(() => accounts.id),
  createdAt: at('created_at').notNull().defaultNow(),
});

// A lost or leaked batch is withdrawn; its unclaimed prizes become reusable.
export const claimBatchRevocations = pgTable('claim_batch_revocations', {
  batchId: uuid('batch_id')
    .primaryKey()
    .references(() => claimCodeBatches.id),
  actorId: uuid('actor_id')
    .notNull()
    .references(() => accounts.id),
  reason: varchar('reason', { length: 500 }).notNull(),
  createdAt: at('created_at').notNull().defaultNow(),
});

export const claimRedemptions = pgTable(
  'claim_redemptions',
  {
    id: uuid('id').primaryKey(),
    codeId: uuid('code_id')
      .notNull()
      .unique()
      .references(() => claimCodes.id),
    taskId: uuid('task_id')
      .notNull()
      .references(() => sponsorTasks.id),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id),
    createdAt: at('created_at').notNull().defaultNow(),
  },
  (t) => [index('claim_redemption_person').on(t.taskId, t.accountId)],
);

// Every claim attempt, kept to stop code guessing. Not part of the money trail.
export const claimAttempts = pgTable(
  'claim_attempts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id),
    succeeded: boolean('succeeded').notNull(),
    createdAt: at('created_at').notNull().defaultNow(),
  },
  (t) => [index('claim_attempt_recent').on(t.accountId, t.createdAt)],
);

// Physical prizes: the winner shows this voucher in store. Only the winner's
// app shows the code, so a business cannot mark a prize handed over alone.
export const prizeVouchers = pgTable(
  'prize_vouchers',
  {
    redemptionId: uuid('redemption_id')
      .primaryKey()
      .references(() => claimRedemptions.id),
    taskId: uuid('task_id')
      .notNull()
      .references(() => sponsorTasks.id),
    code: varchar('code', { length: 12 }).notNull(),
    createdAt: at('created_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('prize_voucher_code').on(t.taskId, t.code)],
);

// The business handed the item over: its locked cash value returns to them.
export const prizeHandovers = pgTable('prize_handovers', {
  redemptionId: uuid('redemption_id')
    .primaryKey()
    .references(() => prizeVouchers.redemptionId),
  actorId: uuid('actor_id')
    .notNull()
    .references(() => accounts.id),
  createdAt: at('created_at').notNull().defaultNow(),
});

// Not handed over within 14 days: the winner took the cash value instead.
export const prizeCashOuts = pgTable('prize_cash_outs', {
  redemptionId: uuid('redemption_id')
    .primaryKey()
    .references(() => prizeVouchers.redemptionId),
  createdAt: at('created_at').notNull().defaultNow(),
});
