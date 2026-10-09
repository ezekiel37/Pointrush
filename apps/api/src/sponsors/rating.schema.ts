import { sql } from 'drizzle-orm';
import {
  check,
  index,
  pgTable,
  smallint,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { accounts } from '../database/schema.js';
import { sponsorProfiles } from './sponsor.schema.js';

const at = (name: string) => timestamp(name, { withTimezone: true });

// One rating per customer per business, only from people the business
// actually served. It keeps the business name at the time, so a rename
// never hides what was said.
export const businessRatings = pgTable(
  'business_ratings',
  {
    id: uuid('id').primaryKey(),
    sponsorId: uuid('sponsor_id')
      .notNull()
      .references(() => sponsorProfiles.id),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id),
    stars: smallint('stars').notNull(),
    comment: varchar('comment', { length: 500 }),
    businessName: varchar('business_name', { length: 120 }).notNull(),
    createdAt: at('created_at').notNull().defaultNow(),
    // Set when the customer edits it within 48 hours.
    editedAt: at('edited_at'),
  },
  (t) => [
    check('business_rating_stars', sql`${t.stars} between 1 and 5`),
    uniqueIndex('business_rating_once').on(t.sponsorId, t.accountId),
    index('business_rating_recent').on(t.sponsorId, t.createdAt),
  ],
);

// The business's public answer. It can answer once and never edit or
// delete the rating itself.
export const businessRatingReplies = pgTable('business_rating_replies', {
  ratingId: uuid('rating_id')
    .primaryKey()
    .references(() => businessRatings.id),
  actorId: uuid('actor_id')
    .notNull()
    .references(() => accounts.id),
  body: varchar('body', { length: 500 }).notNull(),
  createdAt: at('created_at').notNull().defaultNow(),
});

// Only a reviewer removes a rating (abuse, private details), with a reason.
export const businessRatingRemovals = pgTable('business_rating_removals', {
  ratingId: uuid('rating_id')
    .primaryKey()
    .references(() => businessRatings.id),
  reviewerId: uuid('reviewer_id')
    .notNull()
    .references(() => accounts.id),
  reason: varchar('reason', { length: 500 }).notNull(),
  createdAt: at('created_at').notNull().defaultNow(),
});
