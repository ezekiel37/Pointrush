import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { after, before, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { eq } from 'drizzle-orm';
import * as schema from '../src/database/schema.js';
import { AccountsRepository } from '../src/accounts/accounts.repository.js';
import { AccountsService } from '../src/accounts/accounts.service.js';
import { AccountError } from '../src/accounts/account.error.js';
import type { AccountErrorCode } from '../src/accounts/account.error.js';

const pg = new PGlite();
const db = drizzle(pg, { schema });
const service = new AccountsService(new AccountsRepository({ db }));
const isAccountError =
  (code: AccountErrorCode) =>
  (error: unknown): boolean =>
    error instanceof AccountError && error.code === code;

before(async () => {
  await migrate(db, { migrationsFolder: resolve('migrations') });
});
after(async () => {
  await pg.close();
});

test('creation persists one account, profile and canonical username, without verification or privileges', async () => {
  const result = await service.create({
    username: ' Eze ',
    displayName: ' Ezekiel Ojo ',
  });
  assert.match(result.id, /^[0-9a-f-]{36}$/);
  assert.deepEqual(result, {
    id: result.id,
    username: 'eze',
    displayName: 'Ezekiel Ojo',
  });
  const [account] = await db
    .select()
    .from(schema.accounts)
    .where(eq(schema.accounts.id, result.id));
  assert.equal(account?.accessState, 'active');
  const [profile] = await db
    .select()
    .from(schema.accountProfiles)
    .where(eq(schema.accountProfiles.accountId, result.id));
  assert.equal(profile?.usernameChangedAt, null);
  assert.equal((await db.select().from(schema.verifiedPhones)).length, 0);
});

test('case-insensitive duplicate and reserved names roll back the whole creation', async () => {
  const countBefore = (await db.select().from(schema.accounts)).length;
  for (const username of ['EZE', 'Admin']) {
    await assert.rejects(
      service.create({ username, displayName: 'Another Person' }),
      isAccountError('USERNAME_UNAVAILABLE'),
    );
  }
  assert.equal((await db.select().from(schema.accounts)).length, countBefore);
  assert.equal(
    (await db.select().from(schema.accountProfiles)).length,
    countBefore,
  );
});

test('invalid fields are rejected before any account is written', async () => {
  const countBefore = (await db.select().from(schema.accounts)).length;
  assert.throws(
    () =>
      service.create({
        username: 'valid_user',
        displayName: 'Eze',
        role: 'admin',
      }),
    isAccountError('INVALID_ACCOUNT_INPUT'),
  );
  assert.throws(
    () => service.create({ username: 'invalid_', displayName: 'Eze' }),
    isAccountError('INVALID_ACCOUNT_INPUT'),
  );
  assert.equal((await db.select().from(schema.accounts)).length, countBefore);
});

test('first rename succeeds and keeps the account ID and retired username', async () => {
  const account = await service.create({
    username: 'rename_original',
    displayName: 'First Rename',
  });
  const result = await service.rename(account.id, { username: 'Rename_New' });
  assert.deepEqual(result, { ...account, username: 'rename_new' });
  const records = await db
    .select()
    .from(schema.usernames)
    .where(eq(schema.usernames.accountId, account.id));
  assert.equal(records.length, 2);
  assert.equal(
    records.find((row) => row.username === 'rename_original')?.isCurrent,
    false,
  );
  assert.ok(
    records.find((row) => row.username === 'rename_original')
      ?.retiredAt instanceof Date,
  );
  await assert.rejects(
    service.create({
      username: 'rename_original',
      displayName: 'Impersonator',
    }),
    isAccountError('USERNAME_UNAVAILABLE'),
  );
});

test('same-name retry does not start or extend the cooldown', async () => {
  const account = await service.create({
    username: 'retry_original',
    displayName: 'Retry',
  });
  await service.rename(account.id, { username: 'RETRY_ORIGINAL' });
  let [profile] = await db
    .select()
    .from(schema.accountProfiles)
    .where(eq(schema.accountProfiles.accountId, account.id));
  assert.equal(profile?.usernameChangedAt, null);
  await service.rename(account.id, { username: 'retry_new' });
  [profile] = await db
    .select()
    .from(schema.accountProfiles)
    .where(eq(schema.accountProfiles.accountId, account.id));
  const changedAt = profile?.usernameChangedAt?.getTime();
  await service.rename(account.id, { username: 'RETRY_NEW' });
  [profile] = await db
    .select()
    .from(schema.accountProfiles)
    .where(eq(schema.accountProfiles.accountId, account.id));
  assert.equal(profile?.usernameChangedAt?.getTime(), changedAt);
  assert.equal(
    (
      await db
        .select()
        .from(schema.usernames)
        .where(eq(schema.usernames.accountId, account.id))
    ).length,
    2,
  );
});

test('cooldown rejection includes the next eligible date without changing history', async () => {
  const account = await service.create({
    username: 'cooldown_original',
    displayName: 'Cooldown',
  });
  await service.rename(account.id, { username: 'cooldown_new' });
  await assert.rejects(
    service.rename(account.id, { username: 'cooldown_third' }),
    (error: unknown) => {
      assert.ok(error instanceof AccountError);
      assert.equal(error.code, 'USERNAME_CHANGE_TOO_SOON');
      assert.ok(error.eligibleAt instanceof Date);
      assert.ok(error.eligibleAt.getTime() > Date.now() + 29 * 86400000);
      return true;
    },
  );
  assert.equal(
    (
      await db
        .select()
        .from(schema.usernames)
        .where(eq(schema.usernames.accountId, account.id))
    ).length,
    2,
  );
});

test('30-day boundary is based on database time, not client timestamps', async () => {
  const account = await service.create({
    username: 'boundary_original',
    displayName: 'Boundary',
  });
  await service.rename(account.id, { username: 'boundary_second' });
  await pg.query(
    "UPDATE account_profiles SET username_changed_at = clock_timestamp() - interval '720 hours' + interval '1 minute' WHERE account_id = $1",
    [account.id],
  );
  await assert.rejects(
    service.rename(account.id, { username: 'boundary_third' }),
    isAccountError('USERNAME_CHANGE_TOO_SOON'),
  );
  await pg.query(
    "UPDATE account_profiles SET username_changed_at = clock_timestamp() - interval '720 hours' WHERE account_id = $1",
    [account.id],
  );
  assert.equal(
    (await service.rename(account.id, { username: 'boundary_third' })).username,
    'boundary_third',
  );
  assert.throws(
    () =>
      service.rename(account.id, {
        username: 'boundary_fourth',
        usernameChangedAt: null,
      }),
    isAccountError('INVALID_ACCOUNT_INPUT'),
  );
});

test('failed rename restores the old current name and does not consume cooldown', async () => {
  const account = await service.create({
    username: 'rollback_original',
    displayName: 'Rollback',
  });
  await assert.rejects(
    service.rename(account.id, { username: 'admin' }),
    isAccountError('USERNAME_UNAVAILABLE'),
  );
  const [name] = await db
    .select()
    .from(schema.usernames)
    .where(eq(schema.usernames.accountId, account.id));
  assert.equal(name?.isCurrent, true);
  assert.equal(name?.retiredAt, null);
  assert.equal(
    (await service.rename(account.id, { username: 'rollback_success' }))
      .username,
    'rollback_success',
  );
});

test('missing, invalid and inactive account IDs cannot rename', async () => {
  assert.throws(
    () => service.rename('not-a-uuid', { username: 'anything' }),
    isAccountError('INVALID_ACCOUNT_INPUT'),
  );
  await assert.rejects(
    service.rename(randomUUID(), { username: 'anything' }),
    isAccountError('ACCOUNT_NOT_FOUND'),
  );
  for (const state of ['restricted', 'suspended', 'closed']) {
    const account = await service.create({
      username: `state_${state}`,
      displayName: 'State',
    });
    await db
      .update(schema.accounts)
      .set({ accessState: state })
      .where(eq(schema.accounts.id, account.id));
    await assert.rejects(
      service.rename(account.id, { username: `new_${state}` }),
      isAccountError('ACCOUNT_NOT_ACTIVE'),
    );
  }
});
