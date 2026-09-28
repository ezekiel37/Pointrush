import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';
import type { BetterAuthPlugin } from 'better-auth';

export const authEmailJobs = pgTable(
  'auth_email_jobs',
  {
    id: text('id').primaryKey(),
    payload: text('payload'),
    state: text('state').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    availableAt: timestamp('available_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    leaseToken: text('lease_token'),
    leaseUntil: timestamp('lease_until', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('auth_email_jobs_ready_idx').on(t.state, t.availableAt),
    check(
      'auth_email_jobs_state_check',
      sql`${t.state} in ('pending', 'processing', 'accepted', 'expired', 'dead')`,
    ),
    check('auth_email_jobs_attempts_check', sql`${t.attempts} between 0 and 5`),
  ],
);

// This model lets the mail callback insert using Better Auth's active transaction.
export const emailQueuePlugin = {
  id: 'pointrush-email-queue',
  // The default library implementation logs and swallows callback failures.
  // Durable writes must complete or propagate, so signup can roll back.
  init: () => ({
    context: {
      runInBackgroundOrAwait: async (promise: Promise<unknown> | void) => {
        await promise;
      },
    },
  }),
  schema: {
    authEmailJob: {
      modelName: 'authEmailJob',
      fields: {
        payload: { type: 'string', required: false },
        state: { type: 'string', required: true },
        attempts: { type: 'number', required: true },
        availableAt: { type: 'date', required: true },
        expiresAt: { type: 'date', required: true },
        leaseToken: { type: 'string', required: false },
        leaseUntil: { type: 'date', required: false },
        createdAt: { type: 'date', required: true },
      },
    },
  },
} satisfies BetterAuthPlugin;
