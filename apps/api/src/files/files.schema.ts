import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { accounts } from '../database/schema.js';
import { taskProofs } from '../tasks/task-work.schema.js';

const at = (name: string) => timestamp(name, { withTimezone: true });

// One uploaded file, already checked and cleaned. The bytes live in storage
// under purpose/id; this row is what the database trusts.
export const files = pgTable(
  'files',
  {
    id: uuid('id').primaryKey(),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => accounts.id),
    purpose: text('purpose').notNull(),
    contentType: text('content_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    sha256: varchar('sha256', { length: 64 }).notNull(),
    createdAt: at('created_at').notNull().defaultNow(),
  },
  (t) => [
    check('file_purpose', sql`${t.purpose} in ('avatar', 'logo', 'evidence')`),
    check(
      'file_type',
      sql`${t.contentType} in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')
        and (${t.purpose} = 'evidence' or ${t.contentType} <> 'application/pdf')`,
    ),
    check(
      'file_size',
      sql`${t.sizeBytes} > 0 and ${t.sizeBytes} <= case when ${t.purpose} = 'evidence' then 5242880 else 2097152 end`,
    ),
    index('file_owner').on(t.ownerId, t.createdAt),
  ],
);

// Files removed from storage, for example evidence past its keeping time.
export const fileDeletions = pgTable('file_deletions', {
  fileId: uuid('file_id')
    .primaryKey()
    .references(() => files.id),
  reason: varchar('reason', { length: 200 }).notNull(),
  createdAt: at('created_at').notNull().defaultNow(),
});

// Profile pictures, newest first; a null file removes the picture.
export const accountAvatars = pgTable(
  'account_avatars',
  {
    id: uuid('id').primaryKey(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id),
    fileId: uuid('file_id').references(() => files.id),
    createdAt: at('created_at').notNull().defaultNow(),
  },
  (t) => [index('account_avatar_latest').on(t.accountId, t.createdAt)],
);

// Photos or PDFs attached to a proof; fixed once the proof is submitted.
export const taskProofFiles = pgTable(
  'task_proof_files',
  {
    proofId: uuid('proof_id')
      .notNull()
      .references(() => taskProofs.id),
    fileId: uuid('file_id')
      .notNull()
      .unique()
      .references(() => files.id),
    position: integer('position').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.proofId, t.position] }),
    check('task_proof_file_position', sql`${t.position} between 1 and 3`),
  ],
);
