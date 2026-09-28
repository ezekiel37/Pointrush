import {
  bigint,
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { accounts } from '../database/schema.js';

const dates = () => ({
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// Authentication identities are not PointRush accounts or verification badges.
export const authUsers = pgTable('auth_users', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  ...dates(),
});

export const authSessions = pgTable(
  'auth_sessions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => authUsers.id, { onDelete: 'cascade' }),
    token: text('token').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    ...dates(),
  },
  (table) => [
    index('auth_sessions_user_idx').on(table.userId),
    index('auth_sessions_expiry_idx').on(table.expiresAt),
  ],
);

// Better Auth calls this model "account"; it is a credential, not a business account.
export const authCredentials = pgTable(
  'auth_credentials',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => authUsers.id, { onDelete: 'cascade' }),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    password: text('password'),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at', {
      withTimezone: true,
    }),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at', {
      withTimezone: true,
    }),
    scope: text('scope'),
    ...dates(),
  },
  (table) => [
    index('auth_credentials_user_idx').on(table.userId),
    uniqueIndex('auth_credentials_provider_account_idx').on(
      table.providerId,
      table.accountId,
    ),
  ],
);

export const authVerifications = pgTable(
  'auth_verifications',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    ...dates(),
  },
  (table) => [
    index('auth_verifications_identifier_idx').on(table.identifier),
    index('auth_verifications_expiry_idx').on(table.expiresAt),
  ],
);

export const authRateLimits = pgTable('auth_rate_limits', {
  id: text('id').primaryKey(),
  key: text('key').notNull().unique(),
  count: integer('count').notNull(),
  lastRequest: bigint('last_request', { mode: 'number' }).notNull(),
});

export const authEmailBudgets = pgTable('auth_email_budgets', {
  key: text('key').primaryKey(),
  attempts: integer('attempts').notNull().default(1),
  windowStartedAt: timestamp('window_started_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  lastAttemptAt: timestamp('last_attempt_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const authAccountLinks = pgTable('auth_account_links', {
  accountId: uuid('account_id')
    .primaryKey()
    .references(() => accounts.id, { onDelete: 'restrict' }),
  authUserId: text('auth_user_id')
    .notNull()
    .unique()
    .references(() => authUsers.id, { onDelete: 'restrict' }),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const authAdapterSchema = {
  user: authUsers,
  session: authSessions,
  account: authCredentials,
  verification: authVerifications,
  rateLimit: authRateLimits,
};
