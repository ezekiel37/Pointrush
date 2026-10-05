import { index, pgTable, timestamp, uuid } from 'drizzle-orm/pg-core';
import { accounts } from '../database/schema.js';
import { sponsorProfiles } from './sponsor.schema.js';

const at = (name: string) => timestamp(name, { withTimezone: true });

// A person the owner lets run the till. Staff confirm purchases only: they
// cannot void, move money, create campaigns or issue prize codes.
export const businessStaff = pgTable(
  'business_staff',
  {
    id: uuid('id').primaryKey(),
    sponsorId: uuid('sponsor_id')
      .notNull()
      .references(() => sponsorProfiles.id),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id),
    addedBy: uuid('added_by')
      .notNull()
      .references(() => accounts.id),
    createdAt: at('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('business_staff_sponsor').on(t.sponsorId),
    index('business_staff_account').on(t.accountId),
  ],
);

export const businessStaffRemovals = pgTable('business_staff_removals', {
  staffId: uuid('staff_id')
    .primaryKey()
    .references(() => businessStaff.id),
  removedBy: uuid('removed_by')
    .notNull()
    .references(() => accounts.id),
  createdAt: at('created_at').notNull().defaultNow(),
});
