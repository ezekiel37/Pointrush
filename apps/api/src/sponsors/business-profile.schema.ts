import { sql } from 'drizzle-orm';
import {
  bigserial,
  boolean,
  check,
  index,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { accounts } from '../database/schema.js';
import { sponsorProfiles } from './sponsor.schema.js';

const at = (name: string) => timestamp(name, { withTimezone: true });

// A business's public @handle. The newest row is current; older rows stay
// reserved forever and redirect, so old links keep working. Handles share
// one namespace with personal usernames.
export const businessHandles = pgTable(
  'business_handles',
  {
    handle: varchar('handle', { length: 30 }).primaryKey(),
    sponsorId: uuid('sponsor_id')
      .notNull()
      .references(() => sponsorProfiles.id),
    // Increases with every change: the highest per business is current.
    seq: bigserial('seq', { mode: 'number' }).notNull().unique(),
    actorId: uuid('actor_id')
      .notNull()
      .references(() => accounts.id),
    // Required when a reviewer changes a locked handle.
    reason: varchar('reason', { length: 500 }),
    createdAt: at('created_at').notNull().defaultNow(),
  },
  (t) => [
    check(
      'business_handle_format',
      sql`${t.handle} collate "C" ~ '^[a-z][a-z0-9_]{1,28}[a-z0-9]$' and position('__' in ${t.handle}) = 0`,
    ),
    index('business_handle_sponsor').on(t.sponsorId, t.seq),
  ],
);

// Every change to a business's name, contact email or description. A name
// change after a campaign was approved waits for a reviewer.
export const businessProfileChanges = pgTable(
  'business_profile_changes',
  {
    id: uuid('id').primaryKey(),
    sponsorId: uuid('sponsor_id')
      .notNull()
      .references(() => sponsorProfiles.id),
    field: text('field').notNull(),
    oldValue: text('old_value'),
    newValue: text('new_value'),
    needsReview: boolean('needs_review').notNull().default(false),
    actorId: uuid('actor_id')
      .notNull()
      .references(() => accounts.id),
    createdAt: at('created_at').notNull().defaultNow(),
  },
  (t) => [
    check(
      'business_profile_change_field',
      sql`${t.field} in ('name', 'contact_email', 'description', 'logo')`,
    ),
    index('business_profile_change_sponsor').on(t.sponsorId, t.createdAt),
  ],
);

export const businessProfileDecisions = pgTable(
  'business_profile_decisions',
  {
    changeId: uuid('change_id')
      .primaryKey()
      .references(() => businessProfileChanges.id),
    decision: text('decision').notNull(),
    reviewerId: uuid('reviewer_id')
      .notNull()
      .references(() => accounts.id),
    reason: varchar('reason', { length: 500 }).notNull(),
    createdAt: at('created_at').notNull().defaultNow(),
  },
  (t) => [
    check(
      'business_profile_decision',
      sql`${t.decision} in ('applied', 'rejected')`,
    ),
  ],
);

// Display name history; a person can change it once every 7 days.
export const displayNameChanges = pgTable(
  'display_name_changes',
  {
    id: uuid('id').primaryKey(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id),
    oldValue: varchar('old_value', { length: 80 }).notNull(),
    newValue: varchar('new_value', { length: 80 }).notNull(),
    createdAt: at('created_at').notNull().defaultNow(),
  },
  (t) => [index('display_name_change_account').on(t.accountId, t.createdAt)],
);
