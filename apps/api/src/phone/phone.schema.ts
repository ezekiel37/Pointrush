import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  pgTable,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { accounts } from '../database/schema.js';

const at = (name: string) => timestamp(name, { withTimezone: true });

// A one-time code sent by SMS. Only a hash of the code is stored.
export const phoneChallenges = pgTable(
  'phone_challenges',
  {
    id: uuid('id').primaryKey(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id),
    phoneNumber: varchar('phone_number', { length: 16 }).notNull(),
    codeHash: varchar('code_hash', { length: 64 }).notNull(),
    createdAt: at('created_at').notNull().defaultNow(),
    expiresAt: at('expires_at').notNull().defaultNow(),
  },
  (t) => [
    check(
      'phone_challenge_e164',
      sql`${t.phoneNumber} collate "C" ~ '^[+][1-9][0-9]{6,14}$'`,
    ),
    check('phone_challenge_hash', sql`${t.codeHash} ~ '^[0-9a-f]{64}$'`),
    index('phone_challenge_account').on(t.accountId, t.createdAt),
    index('phone_challenge_number').on(t.phoneNumber, t.createdAt),
    index('phone_challenge_day').on(t.createdAt),
  ],
);

// Every code entered, right or wrong; wrong guesses are limited per code.
export const phoneChallengeAttempts = pgTable(
  'phone_challenge_attempts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    challengeId: uuid('challenge_id')
      .notNull()
      .references(() => phoneChallenges.id),
    success: boolean('success').notNull(),
    createdAt: at('created_at').notNull().defaultNow(),
  },
  (t) => [index('phone_attempt_challenge').on(t.challengeId)],
);
