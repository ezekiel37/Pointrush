import { sql } from 'drizzle-orm';
import {
  check,
  primaryKey,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { accounts } from '../database/schema.js';
import { sponsorTasks } from '../sponsors/sponsor.schema.js';

export const taskReviewerGrants = pgTable(
  'task_reviewer_grants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    reviewerId: uuid('reviewer_id')
      .notNull()
      .references(() => accounts.id),
    grantedBy: uuid('granted_by')
      .notNull()
      .references(() => accounts.id),
    reason: varchar('reason', { length: 1000 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedBy: uuid('revoked_by').references(() => accounts.id),
    revocationReason: varchar('revocation_reason', { length: 1000 }),
  },
  (t) => [
    uniqueIndex('one_unrevoked_task_review_grant')
      .on(t.reviewerId)
      .where(sql`${t.revokedAt} is null`),
    check('task_review_grant_duration', sql`${t.expiresAt} > ${t.createdAt}`),
    check('task_review_grant_reason', sql`length(btrim(${t.reason})) > 0`),
    check(
      'task_review_revocation',
      sql`(${t.revokedAt} is null and ${t.revokedBy} is null and ${t.revocationReason} is null) or (${t.revokedAt} is not null and ${t.revokedBy} is not null and ${t.revocationReason} is not null and length(btrim(${t.revocationReason})) > 0 and ${t.revokedAt} >= ${t.createdAt})`,
    ),
  ],
);

export const taskReviewChecklist = {
  permittedObjective: true,
  clearInstructions: true,
  feasibleProof: true,
  fairRewardTerms: true,
  safeDestinations: true,
} as const;
export type TaskReviewChecklist = {
  [K in keyof typeof taskReviewChecklist]: boolean;
};

export const taskReviews = pgTable(
  'task_reviews',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => sponsorTasks.id),
    termsVersion: integer('terms_version').notNull(),
    termsHash: varchar('terms_hash', { length: 64 }).notNull(),
    reviewerId: uuid('reviewer_id')
      .notNull()
      .references(() => accounts.id),
    grantId: uuid('grant_id')
      .notNull()
      .references(() => taskReviewerGrants.id),
    requestId: uuid('request_id').notNull(),
    requestHash: varchar('request_hash', { length: 64 }).notNull(),
    decision: text('decision').notNull(),
    checklist: jsonb('checklist').$type<TaskReviewChecklist>().notNull(),
    reason: varchar('reason', { length: 2000 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex('task_review_request_unique').on(t.reviewerId, t.requestId),
    uniqueIndex('task_review_version_unique').on(t.taskId, t.termsVersion),
    check('task_review_version_positive', sql`${t.termsVersion} > 0`),
    check(
      'task_review_decision',
      sql`${t.decision} in ('approved', 'changes_required', 'rejected')`,
    ),
    check('task_review_reason', sql`length(btrim(${t.reason})) > 0`),
    check(
      'task_review_checklist',
      sql`jsonb_typeof(${t.checklist}) = 'object' and (${t.checklist} - array['permittedObjective', 'clearInstructions', 'feasibleProof', 'fairRewardTerms', 'safeDestinations']) = '{}'::jsonb and ${t.checklist} ?& array['permittedObjective', 'clearInstructions', 'feasibleProof', 'fairRewardTerms', 'safeDestinations'] and jsonb_typeof(${t.checklist}->'permittedObjective') = 'boolean' and jsonb_typeof(${t.checklist}->'clearInstructions') = 'boolean' and jsonb_typeof(${t.checklist}->'feasibleProof') = 'boolean' and jsonb_typeof(${t.checklist}->'fairRewardTerms') = 'boolean' and jsonb_typeof(${t.checklist}->'safeDestinations') = 'boolean'`,
    ),
    check(
      'task_review_approval_complete',
      sql`${t.decision} <> 'approved' or ${t.checklist} = '{"permittedObjective":true,"clearInstructions":true,"feasibleProof":true,"fairRewardTerms":true,"safeDestinations":true}'::jsonb`,
    ),
  ],
);

// Large campaigns need two different reviewers. The first approval is held
// here; the second reviewer's decision is the one that takes effect.
export const campaignFirstApprovals = pgTable(
  'campaign_first_approvals',
  {
    taskId: uuid('task_id')
      .notNull()
      .references(() => sponsorTasks.id),
    termsVersion: integer('terms_version').notNull(),
    reviewerId: uuid('reviewer_id')
      .notNull()
      .references(() => accounts.id),
    reason: varchar('reason', { length: 1000 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.taskId, t.termsVersion] })],
);
