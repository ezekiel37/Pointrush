import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  index,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { accounts } from '../database/schema.js';

const at = (name: string) => timestamp(name, { withTimezone: true });

// A person spends their reward wallet on airtime, data, electricity or TV.
// The amount moves to a hold when the purchase is recorded, then out to the
// provider when it is delivered, or back to the wallet when it fails.
export const billPurchases = pgTable(
  'bill_purchases',
  {
    // Chosen by the client, so a retried request never buys twice.
    id: uuid('id').primaryKey(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id),
    provider: text('provider').notNull(),
    kind: text('kind').notNull(),
    biller: varchar('biller', { length: 40 }).notNull(),
    // Phone number, meter number or decoder (smartcard) number.
    customerRef: varchar('customer_ref', { length: 20 }).notNull(),
    planCode: varchar('plan_code', { length: 60 }),
    amountKobo: bigint('amount_kobo', { mode: 'bigint' }).notNull(),
    createdAt: at('created_at').notNull().defaultNow(),
  },
  (t) => [
    check(
      'bill_kind',
      sql`${t.kind} in ('airtime', 'data', 'electricity', 'tv')`,
    ),
    // ₦50 to ₦50,000 per purchase.
    check('bill_amount', sql`${t.amountKobo} between 5000 and 5000000`),
    check('bill_customer_ref', sql`${t.customerRef} ~ '^[0-9]{10,13}$'`),
    check(
      'bill_plan',
      sql`(${t.kind} in ('data', 'tv')) = (${t.planCode} is not null)`,
    ),
    index('bill_account').on(t.accountId, t.createdAt),
  ],
);

// How a purchase ended, recorded once. A prepaid electricity token is kept so
// the person can see it again.
export const billOutcomes = pgTable(
  'bill_outcomes',
  {
    billId: uuid('bill_id')
      .primaryKey()
      .references(() => billPurchases.id),
    outcome: text('outcome').notNull(),
    providerRef: varchar('provider_ref', { length: 120 }),
    token: varchar('token', { length: 120 }),
    reason: varchar('reason', { length: 300 }).notNull(),
    createdAt: at('created_at').notNull().defaultNow(),
  },
  (t) => [
    check('bill_outcome_kind', sql`${t.outcome} in ('delivered', 'failed')`),
  ],
);
