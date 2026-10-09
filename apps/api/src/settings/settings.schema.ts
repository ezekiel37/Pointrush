import { sql } from 'drizzle-orm';
import {
  bigserial,
  check,
  jsonb,
  pgTable,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { accounts } from '../database/schema.js';

// Business rules an admin can change without a release: minimums and
// referral rewards. Append-only: the newest row is in force, every change
// keeps who made it and why.
export const platformSettings = pgTable(
  'platform_settings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // Increases with every change; the highest version is in force.
    version: bigserial('version', { mode: 'number' }).notNull().unique(),
    settings: jsonb('settings').notNull(),
    // Null only for the defaults installed by the migration.
    actorId: uuid('actor_id').references(() => accounts.id),
    reason: varchar('reason', { length: 500 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check('platform_settings_reason', sql`length(btrim(${t.reason})) > 0`),
  ],
);
