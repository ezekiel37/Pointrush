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
import { sponsorProfiles } from '../sponsors/sponsor.schema.js';

const at = (name: string) => timestamp(name, { withTimezone: true });

// Founder-funded issuance capacity. Points can never exceed the sum of pools.
export const pointsPools = pgTable(
  'points_pools',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    points: bigint('points', { mode: 'bigint' }).notNull(),
    actorId: uuid('actor_id')
      .notNull()
      .references(() => accounts.id),
    reason: varchar('reason', { length: 500 }).notNull(),
    createdAt: at('created_at').notNull().defaultNow(),
  },
  (t) => [check('points_pool_positive', sql`${t.points} > 0`)],
);

// Append-only issuance from settled activity only.
export const pointsEntries = pgTable(
  'points_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id),
    kind: text('kind').notNull(),
    reference: varchar('reference', { length: 200 }).notNull(),
    // The business behind a purchase or job; activity counts once per business.
    businessId: uuid('business_id').references(() => sponsorProfiles.id),
    points: bigint('points', { mode: 'bigint' }).notNull(),
    availableAt: at('available_at').notNull(),
    createdAt: at('created_at').notNull().defaultNow(),
  },
  (t) => [
    check(
      'points_entry_kind',
      sql`${t.kind} in ('purchase', 'job', 'referral_referrer', 'referral_referee')`,
    ),
    check('points_entry_positive', sql`${t.points} > 0`),
    uniqueIndex('points_entry_reference').on(t.kind, t.reference),
    uniqueIndex('points_once_per_business')
      .on(t.accountId, t.kind, t.businessId)
      .where(sql`${t.kind} in ('purchase', 'job')`),
    index('points_entry_account').on(t.accountId, t.createdAt),
  ],
);

// One referrer per account, attributed only while the account is new.
export const referrals = pgTable(
  'referrals',
  {
    refereeId: uuid('referee_id')
      .primaryKey()
      .references(() => accounts.id),
    referrerId: uuid('referrer_id')
      .notNull()
      .references(() => accounts.id),
    createdAt: at('created_at').notNull().defaultNow(),
  },
  (t) => [
    check('referral_not_self', sql`${t.refereeId} <> ${t.referrerId}`),
    index('referral_referrer').on(t.referrerId, t.createdAt),
  ],
);
