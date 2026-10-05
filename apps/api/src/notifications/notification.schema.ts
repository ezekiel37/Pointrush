import { pgTable, timestamp, uuid } from 'drizzle-orm/pg-core';
import { accounts } from '../database/schema.js';

// The notification feed is derived from money and review records, so it can
// never disagree with them. Only how far a person has read is stored.
export const notificationReads = pgTable('notification_reads', {
  accountId: uuid('account_id')
    .primaryKey()
    .references(() => accounts.id),
  seenUntil: timestamp('seen_until', { withTimezone: true }).notNull(),
});
