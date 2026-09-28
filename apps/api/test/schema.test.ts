import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { readMigrationFiles } from 'drizzle-orm/migrator';

const database = new PGlite();
const folder = resolve('migrations');
const isCode =
  (code: string) =>
  (error: unknown): boolean =>
    error instanceof Error && 'code' in error && error.code === code;

before(async () => {
  await migrate(drizzle(database), { migrationsFolder: folder });
});
after(async () => {
  await database.close();
});

async function account(): Promise<string> {
  const id = randomUUID();
  await database.query('INSERT INTO accounts (id) VALUES ($1)', [id]);
  return id;
}

test('checked-in migrations apply once and reruns preserve history and data', async () => {
  const id = await account();
  await migrate(drizzle(database), { migrationsFolder: folder });
  const history = await database.query(
    'SELECT * FROM drizzle.__drizzle_migrations',
  );
  assert.equal(
    history.rows.length,
    readMigrationFiles({ migrationsFolder: folder }).length,
  );
  const result = await database.query('SELECT id FROM accounts WHERE id = $1', [
    id,
  ]);
  assert.equal(result.rows.length, 1);
});

test('accounts cannot acquire invented privilege states', async () => {
  await assert.rejects(
    database.query("INSERT INTO accounts (access_state) VALUES ('admin')"),
    isCode('23514'),
  );
});

test('username boundaries and ASCII canonical form are enforced in PostgreSQL', async () => {
  for (const username of [
    'ab',
    'a'.repeat(21),
    'Eze',
    '1abc',
    'abc_',
    'ab__cd',
    'éze',
    'abc-def',
    'a b',
    ' aab',
  ]) {
    await assert.rejects(
      database.query('INSERT INTO usernames (username) VALUES ($1)', [
        username,
      ]),
    );
  }
  for (const username of ['abc', 'a'.repeat(20), 'abc_123']) {
    await database.query(
      'INSERT INTO usernames (username, account_id, is_current) VALUES ($1, $2, true)',
      [username, await account()],
    );
  }
});

test('platform names and one current username per account are enforced', async () => {
  const id = await account();
  await assert.rejects(
    database.query(
      "INSERT INTO usernames (username, account_id, is_current) VALUES ('pointrush', $1, true)",
      [id],
    ),
    isCode('23505'),
  );
  await database.query(
    "INSERT INTO usernames (username, account_id, is_current) VALUES ('first_name', $1, true)",
    [id],
  );
  await assert.rejects(
    database.query(
      "INSERT INTO usernames (username, account_id, is_current) VALUES ('second_name', $1, true)",
      [id],
    ),
    isCode('23505'),
  );
});

test('nulls cannot bypass username ownership constraints', async () => {
  const id = await account();
  await assert.rejects(
    database.query(
      "INSERT INTO usernames (username, account_id) VALUES ('orphan_name', $1)",
      [id],
    ),
    isCode('23514'),
  );
  await assert.rejects(
    database.query(
      "INSERT INTO usernames (username, is_current) VALUES ('ownerless', true)",
    ),
    isCode('23514'),
  );
});

test('retiring a username preserves its owner and prevents reuse', async () => {
  const id = await account();
  await database.query(
    "INSERT INTO usernames (username, account_id, is_current) VALUES ('old_name', $1, true)",
    [id],
  );
  await database.query(
    "UPDATE usernames SET is_current = false, retired_at = now() WHERE username = 'old_name'",
  );
  await database.query(
    "INSERT INTO usernames (username, account_id, is_current) VALUES ('new_name', $1, true)",
    [id],
  );
  await assert.rejects(
    database.query(
      "INSERT INTO usernames (username, account_id, is_current) VALUES ('old_name', $1, true)",
      [await account()],
    ),
    isCode('23505'),
  );
  await assert.rejects(
    database.query(
      "UPDATE usernames SET is_current = true, retired_at = null WHERE username = 'old_name'",
    ),
    isCode('23514'),
  );
  await assert.rejects(
    database.query(
      "UPDATE usernames SET username = 'stolen_name' WHERE username = 'new_name'",
    ),
    isCode('23514'),
  );
  await assert.rejects(
    database.query(
      "UPDATE usernames SET account_id = $1 WHERE username = 'new_name'",
      [await account()],
    ),
    isCode('23514'),
  );
  await assert.rejects(
    database.query("DELETE FROM usernames WHERE username = 'old_name'"),
    isCode('23514'),
  );
  await assert.rejects(
    database.query(
      "UPDATE usernames SET account_id = $1, is_current = true WHERE username = 'admin'",
      [id],
    ),
    isCode('23514'),
  );
});

test('verified phone ownership is unique and requires an existing account', async () => {
  const id = await account();
  await database.query(
    "INSERT INTO verified_phones (account_id, phone_number) VALUES ($1, '+2348031234567')",
    [id],
  );
  await assert.rejects(
    database.query(
      "INSERT INTO verified_phones (account_id, phone_number) VALUES ($1, '+2348031234567')",
      [await account()],
    ),
    isCode('23505'),
  );
  await assert.rejects(
    database.query(
      "INSERT INTO verified_phones (account_id, phone_number) VALUES ($1, '+2348031234568')",
      [randomUUID()],
    ),
    isCode('23503'),
  );
  await assert.rejects(
    database.query('DELETE FROM accounts WHERE id = $1', [id]),
    (error: unknown) => isCode('23503')(error) || isCode('23001')(error),
  );
});

test('phone storage rejects local formatting, invalid characters and overlong values', async () => {
  for (const number of [
    '08031234567',
    '+234 8031234567',
    '+02348031234567',
    '+2348031234567890',
    '+abc',
    '',
  ]) {
    await assert.rejects(
      database.query(
        'INSERT INTO verified_phones (account_id, phone_number) VALUES ($1, $2)',
        [await account(), number],
      ),
    );
  }
});

test('a failed account and username transaction leaves no partial account', async () => {
  const id = randomUUID();
  await assert.rejects(
    database.transaction(async (tx) => {
      await tx.query('INSERT INTO accounts (id) VALUES ($1)', [id]);
      await tx.query(
        "INSERT INTO usernames (username, account_id, is_current) VALUES ('admin', $1, true)",
        [id],
      );
    }),
    isCode('23505'),
  );
  const result = await database.query('SELECT id FROM accounts WHERE id = $1', [
    id,
  ]);
  assert.equal(result.rows.length, 0);
});

test('PostgreSQL rolls back DDL when a transaction fails', async () => {
  await assert.rejects(
    database.transaction(async (tx) => {
      await tx.exec('CREATE TABLE failed_migration_probe (id integer)');
      await tx.exec('SELECT 1 / 0');
    }),
  );
  const result = await database.query<{ relation: string | null }>(
    "SELECT to_regclass('failed_migration_probe') AS relation",
  );
  assert.equal(result.rows[0]?.relation, null);
});
