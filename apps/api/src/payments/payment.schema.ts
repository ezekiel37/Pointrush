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

// A business's request to add funds, recorded before it is sent to pay. The
// provider confirmation must match this amount and currency exactly.
export const fundingIntents = pgTable(
  'funding_intents',
  {
    id: uuid('id').primaryKey(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id),
    provider: text('provider').notNull(),
    amountKobo: bigint('amount_kobo', { mode: 'bigint' }).notNull(),
    currency: text('currency').notNull().default('NGN'),
    providerSessionId: varchar('provider_session_id', { length: 200 }),
    createdAt: at('created_at').notNull().defaultNow(),
  },
  (t) => [
    check(
      'funding_intent_amount',
      sql`${t.amountKobo} between 100000 and 10000000000`,
    ),
    check('funding_intent_currency', sql`${t.currency} = 'NGN'`),
    index('funding_intent_account').on(t.accountId, t.createdAt),
  ],
);

// Verified provider notifications, stored once per provider event. Only the
// fields needed to settle money are kept; raw payloads (personal data) are not.
export const paymentEvents = pgTable(
  'payment_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    provider: text('provider').notNull(),
    eventId: varchar('event_id', { length: 200 }).notNull(),
    type: varchar('type', { length: 80 }).notNull(),
    reference: uuid('reference'),
    amountKobo: bigint('amount_kobo', { mode: 'bigint' }),
    currency: text('currency'),
    outcome: text('outcome').notNull(),
    receivedAt: at('received_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('payment_event_once').on(t.provider, t.eventId),
    check(
      'payment_event_outcome',
      sql`${t.outcome} in ('credited', 'payout_paid', 'payout_failed', 'mismatch', 'unknown_reference', 'ignored')`,
    ),
  ],
);

// Where a person's withdrawals go. Registered with the provider, which checks
// the account at the bank and returns the name it holds. Only the last four
// digits are kept here. Changing account adds a new row; the newest is used.
export const payoutDestinations = pgTable(
  'payout_destinations',
  {
    id: uuid('id').primaryKey(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id),
    provider: text('provider').notNull(),
    providerDestinationId: varchar('provider_destination_id', {
      length: 120,
    }).notNull(),
    bankCode: varchar('bank_code', { length: 20 }).notNull(),
    bankName: varchar('bank_name', { length: 120 }).notNull(),
    accountName: varchar('account_name', { length: 160 }).notNull(),
    accountLast4: varchar('account_last4', { length: 4 }).notNull(),
    createdAt: at('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('payout_destination_account').on(t.accountId, t.createdAt),
    uniqueIndex('payout_destination_provider_id').on(
      t.provider,
      t.providerDestinationId,
    ),
    check('payout_destination_last4', sql`${t.accountLast4} ~ '^[0-9]{4}$'`),
  ],
);

// A withdrawal moves money from the wallet into a hold immediately.
export const withdrawals = pgTable(
  'withdrawals',
  {
    id: uuid('id').primaryKey(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id),
    amountKobo: bigint('amount_kobo', { mode: 'bigint' }).notNull(),
    // Required for new withdrawals; earlier rows predate destinations.
    destinationId: uuid('destination_id').references(
      () => payoutDestinations.id,
    ),
    createdAt: at('created_at').notNull().defaultNow(),
  },
  (t) => [
    check(
      'withdrawal_amount',
      sql`${t.amountKobo} between 100000 and 100000000`,
    ),
    index('withdrawal_account').on(t.accountId, t.createdAt),
  ],
);

// The provider accepted the payout instruction.
export const withdrawalSubmissions = pgTable(
  'withdrawal_submissions',
  {
    withdrawalId: uuid('withdrawal_id')
      .primaryKey()
      .references(() => withdrawals.id),
    provider: text('provider').notNull(),
    providerPayoutId: varchar('provider_payout_id', { length: 200 }).notNull(),
    createdAt: at('created_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('withdrawal_provider_payout').on(
      t.provider,
      t.providerPayoutId,
    ),
  ],
);

// Final result: paid closes the hold; failed returns the money to the wallet.
export const withdrawalOutcomes = pgTable(
  'withdrawal_outcomes',
  {
    withdrawalId: uuid('withdrawal_id')
      .primaryKey()
      .references(() => withdrawals.id),
    outcome: text('outcome').notNull(),
    reason: varchar('reason', { length: 300 }).notNull(),
    createdAt: at('created_at').notNull().defaultNow(),
  },
  (t) => [
    check('withdrawal_outcome_kind', sql`${t.outcome} in ('paid', 'failed')`),
  ],
);

// "This wasn't me": the owner (or a reviewer) stops all withdrawals at once.
// Only a reviewer lifts it, after checking.
export const withdrawalLocks = pgTable(
  'withdrawal_locks',
  {
    id: uuid('id').primaryKey(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id),
    reason: varchar('reason', { length: 300 }).notNull(),
    createdAt: at('created_at').notNull().defaultNow(),
  },
  (t) => [index('withdrawal_lock_account').on(t.accountId)],
);
export const withdrawalUnlocks = pgTable('withdrawal_unlocks', {
  lockId: uuid('lock_id')
    .primaryKey()
    .references(() => withdrawalLocks.id),
  actorId: uuid('actor_id')
    .notNull()
    .references(() => accounts.id),
  createdAt: at('created_at').notNull().defaultNow(),
});
