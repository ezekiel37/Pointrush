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

// A withdrawal moves money from the wallet into a hold immediately.
export const withdrawals = pgTable(
  'withdrawals',
  {
    id: uuid('id').primaryKey(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id),
    amountKobo: bigint('amount_kobo', { mode: 'bigint' }).notNull(),
    createdAt: at('created_at').notNull().defaultNow(),
  },
  (t) => [
    check(
      'withdrawal_amount',
      sql`${t.amountKobo} between 50000 and 500000000`,
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
