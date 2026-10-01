import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { accounts } from '../database/schema.js';
import { fundingAccounts } from '../funding/funding.schema.js';

export const sponsorProfiles = pgTable(
  'sponsor_profiles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => accounts.id),
    name: varchar('name', { length: 120 }).notNull(),
    contactEmail: varchar('contact_email', { length: 320 }).notNull(),
    termsVersion: varchar('terms_version', { length: 80 }).notNull(),
    termsAcceptedAt: timestamp('terms_accepted_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex('sponsor_owner_unique').on(t.ownerId),
    check('sponsor_name_present', sql`length(btrim(${t.name})) > 0`),
    check('sponsor_terms_present', sql`length(btrim(${t.termsVersion})) > 0`),
  ],
);

export const sponsorTasks = pgTable(
  'sponsor_tasks',
  {
    id: uuid('id').primaryKey(),
    sponsorId: uuid('sponsor_id')
      .notNull()
      .references(() => sponsorProfiles.id),
    requestId: uuid('request_id').notNull(),
    requestHash: varchar('request_hash', { length: 64 }).notNull(),
    termsVersion: integer('terms_version').notNull().default(1),
    allocationAccountId: uuid('allocation_account_id')
      .notNull()
      .references(() => fundingAccounts.id),
    title: varchar('title', { length: 160 }).notNull(),
    instructions: text('instructions').notNull(),
    proofRequirements: text('proof_requirements').notNull(),
    rejectionCriteria: text('rejection_criteria').notNull(),
    model: text('model').notNull(),
    capacity: integer('capacity').notNull(),
    rewardKobo: bigint('reward_kobo', { mode: 'bigint' }).notNull(),
    budgetKobo: bigint('budget_kobo', { mode: 'bigint' }).notNull(),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    reviewState: text('review_state').notNull().default('pending_review'),
    lifecycle: text('lifecycle').notNull().default('not_live'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex('sponsor_task_request_unique').on(t.sponsorId, t.requestId),
    uniqueIndex('sponsor_task_allocation_unique').on(t.allocationAccountId),
    check(
      'sponsor_task_model',
      sql`${t.model} in ('capped_fixed', 'selected_assignment')`,
    ),
    check(
      'sponsor_task_budget',
      sql`${t.capacity} > 0 and ${t.rewardKobo} > 0 and ${t.budgetKobo} = ${t.rewardKobo}::numeric * ${t.capacity}`,
    ),
    check('sponsor_task_dates', sql`${t.endsAt} > ${t.startsAt}`),
    // No publication path is implemented until reviewer authorization exists.
    check(
      'sponsor_task_review_gate',
      sql`${t.reviewState} in ('pending_review', 'approved', 'changes_required', 'rejected') and ${t.lifecycle} = 'not_live' and ${t.termsVersion} > 0`,
    ),
  ],
);
