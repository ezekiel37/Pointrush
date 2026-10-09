import { sql } from 'drizzle-orm';
import {
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

// Security events that are not money movements (those are in the funding
// ledger): sign-ins, wrong passwords on money actions, session revocations and
// what reviewers looked at. Append-only: rows can never be changed or deleted.
export const auditEvents = pgTable(
  'audit_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kind: text('kind').notNull(),
    // The person the event is about (auth user ID, as sessions use it).
    subject: text('subject').notNull(),
    // Who did it, when it was someone else (a reviewer).
    actor: text('actor'),
    // Small, non-secret context; never passwords, codes or full card/bank data.
    detail: jsonb('detail').$type<Record<string, string | number | boolean>>(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check(
      'audit_event_kind',
      sql`${t.kind} in ('sign_in', 'money_password_failed', 'sessions_revoked', 'session_revoked', 'admin_account_viewed', 'admin_payments_viewed', 'admin_disputes_viewed', 'admin_settings_changed', 'admin_search', 'referral_pool_funded')`,
    ),
    index('audit_subject_recent').on(t.subject, t.kind, t.createdAt),
  ],
);
