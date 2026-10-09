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

const at = (name: string) => timestamp(name, { withTimezone: true });

// Money Acticlaim puts into its referral pool. A settings admin records each
// deposit with the bank reference; rewards can never exceed what was put in.
export const referralPoolTopups = pgTable(
  'referral_pool_topups',
  {
    id: uuid('id').primaryKey(),
    amountKobo: bigint('amount_kobo', { mode: 'bigint' }).notNull(),
    actorId: uuid('actor_id')
      .notNull()
      .references(() => accounts.id),
    bankReference: varchar('bank_reference', { length: 120 }).notNull(),
    reason: varchar('reason', { length: 500 }).notNull(),
    createdAt: at('created_at').notNull().defaultNow(),
  },
  (t) => [
    check('referral_topup_positive', sql`${t.amountKobo} > 0`),
    check(
      'referral_topup_reference',
      sql`length(btrim(${t.bankReference})) > 0 and length(btrim(${t.reason})) > 0`,
    ),
  ],
);

// One cash reward per invited person and kind, paid from the pool.
export const referralRewards = pgTable(
  'referral_rewards',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    refereeId: uuid('referee_id')
      .notNull()
      .references(() => accounts.id),
    referrerId: uuid('referrer_id')
      .notNull()
      .references(() => accounts.id),
    kind: text('kind').notNull(),
    amountKobo: bigint('amount_kobo', { mode: 'bigint' }).notNull(),
    // What the reward was measured against: the friend's payout, or what
    // the business paid its customers.
    basisKobo: bigint('basis_kobo', { mode: 'bigint' }).notNull(),
    createdAt: at('created_at').notNull().defaultNow(),
  },
  (t) => [
    check('referral_reward_kind', sql`${t.kind} in ('friend', 'business')`),
    check('referral_reward_positive', sql`${t.amountKobo} > 0`),
    uniqueIndex('referral_reward_once').on(t.refereeId, t.kind),
    index('referral_reward_referrer').on(t.referrerId, t.createdAt),
  ],
);
