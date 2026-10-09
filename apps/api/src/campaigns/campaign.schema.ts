import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  index,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { accounts } from '../database/schema.js';
import { sponsorTasks } from '../sponsors/sponsor.schema.js';

const at = (name: string) => timestamp(name, { withTimezone: true });

// Short-lived, single-use, per-shopper code. A printed static code is never proof.
export const purchaseCodes = pgTable(
  'purchase_codes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => sponsorTasks.id),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id),
    code: varchar('code', { length: 10 }).notNull(),
    expiresAt: at('expires_at').notNull(),
    createdAt: at('created_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('purchase_code_unique').on(t.code),
    index('purchase_code_owner').on(t.accountId, t.taskId),
    check('purchase_code_format', sql`${t.code} ~ '^[A-HJKMNP-Z2-9]{10}$'`),
  ],
);

// The business confirms a real purchase at the till.
export const purchaseConfirmations = pgTable(
  'purchase_confirmations',
  {
    id: uuid('id').primaryKey(),
    codeId: uuid('code_id')
      .notNull()
      .unique()
      .references(() => purchaseCodes.id),
    taskId: uuid('task_id')
      .notNull()
      .references(() => sponsorTasks.id),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id),
    actorId: uuid('actor_id')
      .notNull()
      .references(() => accounts.id),
    amountKobo: bigint('amount_kobo', { mode: 'bigint' }).notNull(),
    // 'once' for a one-off offer; the Lagos calendar month ('2026-10') for a
    // monthly offer. Set by the database, never by the caller.
    period: varchar('period', { length: 7 }).notNull().default('once'),
    releaseAt: at('release_at').notNull(),
    createdAt: at('created_at').notNull().defaultNow(),
  },
  (t) => [
    // One cash back per shopper per campaign, or per month for monthly offers.
    uniqueIndex('purchase_once_per_period').on(t.taskId, t.accountId, t.period),
    check(
      'purchase_period_format',
      sql`${t.period} = 'once' or ${t.period} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`,
    ),
    index('purchase_shopper_recent').on(t.accountId, t.createdAt),
    check('purchase_amount_positive', sql`${t.amountKobo} > 0`),
  ],
);

// The business withdraws cash back during the hold, for example after a refund.
export const purchaseVoids = pgTable('purchase_voids', {
  confirmationId: uuid('confirmation_id')
    .primaryKey()
    .references(() => purchaseConfirmations.id),
  actorId: uuid('actor_id')
    .notNull()
    .references(() => accounts.id),
  reason: varchar('reason', { length: 500 }).notNull(),
  createdAt: at('created_at').notNull().defaultNow(),
});

// A shopper who says a void was wrong can dispute it within 7 days. The voided
// cash back stays locked in the campaign until a reviewer rules.
export const purchaseVoidDisputes = pgTable('purchase_void_disputes', {
  confirmationId: uuid('confirmation_id')
    .primaryKey()
    .references(() => purchaseConfirmations.id),
  accountId: uuid('account_id')
    .notNull()
    .references(() => accounts.id),
  note: varchar('note', { length: 500 }).notNull(),
  createdAt: at('created_at').notNull().defaultNow(),
});

// A reviewer's decision on a dispute: the void stands ('upheld'), or the
// shopper is paid from the campaign ('reversed').
export const purchaseVoidRulings = pgTable(
  'purchase_void_rulings',
  {
    confirmationId: uuid('confirmation_id')
      .primaryKey()
      .references(() => purchaseConfirmations.id),
    reviewerId: uuid('reviewer_id')
      .notNull()
      .references(() => accounts.id),
    decision: varchar('decision', { length: 20 }).notNull(),
    reason: varchar('reason', { length: 500 }).notNull(),
    createdAt: at('created_at').notNull().defaultNow(),
  },
  (t) => [
    check(
      'purchase_void_ruling_decision',
      sql`${t.decision} in ('upheld', 'reversed')`,
    ),
  ],
);

// After the hold, the shopper moves cash back into their reward wallet once.
export const purchaseReleases = pgTable('purchase_releases', {
  confirmationId: uuid('confirmation_id')
    .primaryKey()
    .references(() => purchaseConfirmations.id),
  createdAt: at('created_at').notNull().defaultNow(),
});

// Unused campaign money returned to the business's available balance: the
// whole budget before publication, or what no shopper is owed after the end.
// The amount is computed by the database, never supplied by the caller.
export const campaignReturns = pgTable(
  'campaign_returns',
  {
    id: uuid('id').primaryKey(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => sponsorTasks.id),
    actorId: uuid('actor_id')
      .notNull()
      .references(() => accounts.id),
    amountKobo: bigint('amount_kobo', { mode: 'bigint' })
      .notNull()
      .default(sql`0`),
    createdAt: at('created_at').notNull().defaultNow(),
  },
  (t) => [
    check('campaign_return_positive', sql`${t.amountKobo} > 0`),
    index('campaign_return_task').on(t.taskId),
  ],
);
