import { sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  uniqueIndex,
  check,
} from 'drizzle-orm/pg-core';
import { accounts } from '../database/schema.js';
import { sponsorTasks } from '../sponsors/sponsor.schema.js';
const createdAt = () =>
  timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
export const taskPublications = pgTable('task_publications', {
  taskId: uuid('task_id')
    .primaryKey()
    .references(() => sponsorTasks.id),
  actorId: uuid('actor_id')
    .notNull()
    .references(() => accounts.id),
  createdAt: createdAt(),
});
export const taskClaims = pgTable(
  'task_claims',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => sponsorTasks.id),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('task_claim_once').on(t.taskId, t.accountId)],
);
export const taskProofs = pgTable(
  'task_proofs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    claimId: uuid('claim_id')
      .notNull()
      .references(() => taskClaims.id),
    revision: integer('revision').notNull(),
    evidence: text('evidence').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('task_proof_revision').on(t.claimId, t.revision),
    check('task_proof_revision_range', sql`${t.revision} in (1,2)`),
  ],
);
export const proofDecisions = pgTable(
  'proof_decisions',
  {
    id: uuid('id').primaryKey(),
    proofId: uuid('proof_id')
      .notNull()
      .unique()
      .references(() => taskProofs.id),
    actorId: uuid('actor_id')
      .notNull()
      .references(() => accounts.id),
    decision: text('decision').notNull(),
    reason: text('reason').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    check(
      'proof_decision_state',
      sql`${t.decision} in ('approved','changes_required','rejected')`,
    ),
  ],
);
export const taskAppeals = pgTable('task_appeals', {
  id: uuid('id').primaryKey(),
  proofId: uuid('proof_id')
    .notNull()
    .unique()
    .references(() => taskProofs.id),
  reason: text('reason').notNull(),
  createdAt: createdAt(),
});
// Separate permission: task review permission alone never permits arbitration.
export const appealReviewerGrants = pgTable('appeal_reviewer_grants', {
  id: uuid('id').primaryKey().defaultRandom(),
  accountId: uuid('account_id')
    .notNull()
    .references(() => accounts.id),
  grantedBy: uuid('granted_by')
    .notNull()
    .references(() => accounts.id),
  reason: text('reason').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  createdAt: createdAt(),
});
export const appealResolutions = pgTable(
  'appeal_resolutions',
  {
    id: uuid('id').primaryKey(),
    appealId: uuid('appeal_id')
      .notNull()
      .unique()
      .references(() => taskAppeals.id),
    actorId: uuid('actor_id')
      .notNull()
      .references(() => accounts.id),
    grantId: uuid('grant_id')
      .notNull()
      .references(() => appealReviewerGrants.id),
    decision: text('decision').notNull(),
    reason: text('reason').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    check(
      'appeal_resolution_state',
      sql`${t.decision} in ('approved','upheld')`,
    ),
  ],
);

// A participant explicitly acknowledges the decision. Windows must not expire
// while a decision has never been delivered/read by the participant.
export const proofDecisionReceipts = pgTable('proof_decision_receipts', {
  proofId: uuid('proof_id')
    .primaryKey()
    .references(() => taskProofs.id),
  createdAt: createdAt(),
});
