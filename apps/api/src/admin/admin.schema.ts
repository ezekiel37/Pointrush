import { index, pgTable, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import { accounts } from '../database/schema.js';
import { paymentEvents } from '../payments/payment.schema.js';

const at = (name: string) => timestamp(name, { withTimezone: true });

// Every freeze and unfreeze, by whom and why. Inserting a row applies it.
export const accountAccessChanges = pgTable(
  'account_access_changes',
  {
    id: uuid('id').primaryKey(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id),
    fromState: varchar('from_state', { length: 20 }).notNull().default(''),
    toState: varchar('to_state', { length: 20 }).notNull(),
    reason: varchar('reason', { length: 500 }).notNull(),
    actorId: uuid('actor_id')
      .notNull()
      .references(() => accounts.id),
    createdAt: at('created_at').notNull().defaultNow(),
  },
  (t) => [index('account_access_change_account').on(t.accountId, t.createdAt)],
);

// A person's note on a flagged payment event. Notes never move money.
export const paymentEventReviews = pgTable('payment_event_reviews', {
  eventId: uuid('event_id')
    .primaryKey()
    .references(() => paymentEvents.id),
  reviewerId: uuid('reviewer_id')
    .notNull()
    .references(() => accounts.id),
  note: varchar('note', { length: 1000 }).notNull(),
  createdAt: at('created_at').notNull().defaultNow(),
});
