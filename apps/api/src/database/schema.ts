import { sql } from 'drizzle-orm';
export {
  authUsers,
  authSessions,
  authCredentials,
  authVerifications,
  authRateLimits,
  authAccountLinks,
} from '../auth/auth.schema.js';
import {
  boolean,
  check,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

export const accounts = pgTable(
  'accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    accessState: text('access_state').notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      'accounts_access_state_check',
      sql`${table.accessState} in ('active', 'restricted', 'suspended', 'closed')`,
    ),
  ],
);

export const accountProfiles = pgTable(
  'account_profiles',
  {
    accountId: uuid('account_id')
      .primaryKey()
      .references(() => accounts.id, { onDelete: 'restrict' }),
    displayName: varchar('display_name', { length: 80 }).notNull(),
    usernameChangedAt: timestamp('username_changed_at', { withTimezone: true }),
  },
  (table) => [
    check(
      'account_profiles_display_name_check',
      sql`char_length(${table.displayName}) between 1 and 80 and ${table.displayName} = btrim(${table.displayName}) and ${table.displayName} !~ '[[:cntrl:]]'`,
    ),
  ],
);

// Current, historical, and platform-reserved usernames share one namespace.
export const usernames = pgTable(
  'usernames',
  {
    username: varchar('username', { length: 20 }).primaryKey(),
    accountId: uuid('account_id').references(() => accounts.id, {
      onDelete: 'restrict',
    }),
    isCurrent: boolean('is_current').notNull().default(false),
    claimedAt: timestamp('claimed_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    retiredAt: timestamp('retired_at', { withTimezone: true }),
  },
  (table) => [
    check(
      'usernames_format_check',
      sql`${table.username} collate "C" ~ '^[a-z][a-z0-9_]{1,18}[a-z0-9]$' and position('__' in ${table.username}) = 0`,
    ),
    check(
      'usernames_ownership_check',
      sql`(
    (${table.accountId} is null and not ${table.isCurrent} and ${table.retiredAt} is null)
    or (${table.accountId} is not null and (
      (${table.isCurrent} and ${table.retiredAt} is null)
      or (not ${table.isCurrent} and ${table.retiredAt} is not null and ${table.retiredAt} >= ${table.claimedAt})
    ))
  ) and (not ${table.isCurrent} or ${table.retiredAt} is null)`,
    ),
    uniqueIndex('usernames_one_current_per_account')
      .on(table.accountId)
      .where(sql`${table.isCurrent}`),
  ],
);

// Pending phone challenges belong to authentication, not this ownership table.
export const verifiedPhones = pgTable(
  'verified_phones',
  {
    accountId: uuid('account_id')
      .primaryKey()
      .references(() => accounts.id, { onDelete: 'restrict' }),
    phoneNumber: varchar('phone_number', { length: 16 }).notNull().unique(),
    verifiedAt: timestamp('verified_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // Storage shape only; country, type and reachability checks belong to verification.
    check(
      'verified_phones_e164_check',
      sql`${table.phoneNumber} collate "C" ~ '^[+][1-9][0-9]{0,14}$'`,
    ),
  ],
);
