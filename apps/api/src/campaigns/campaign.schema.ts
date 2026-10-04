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
    releaseAt: at('release_at').notNull(),
    createdAt: at('created_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('purchase_once_per_campaign').on(t.taskId, t.accountId),
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

// After the hold, the shopper moves cash back into their reward wallet once.
export const purchaseReleases = pgTable('purchase_releases', {
  confirmationId: uuid('confirmation_id')
    .primaryKey()
    .references(() => purchaseConfirmations.id),
  createdAt: at('created_at').notNull().defaultNow(),
});
