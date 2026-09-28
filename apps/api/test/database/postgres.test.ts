import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { after, before, test } from 'node:test';
import { Client, Pool } from 'pg';
import { eq } from 'drizzle-orm';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import type { DatabaseConfig } from '../../src/database/database.config.js';
import { readDatabaseConfig } from '../../src/database/database.config.js';
import { DatabaseService } from '../../src/database/database.service.js';
import { migrationLock, runMigrations } from '../../src/database/migrate.js';
import { accounts, usernames } from '../../src/database/schema.js';
import { configureHttp } from '../../src/http/configure-http.js';

const databaseName = `pointrush_test_${randomUUID().replaceAll('-', '')}`;
const folder = resolve('migrations');
let admin: Client;
let pool: Pool;
let database: DatabaseService;
let config: DatabaseConfig;
let created = false;

before(async () => {
  if (!process.env.TEST_DATABASE_URL)
    throw new Error(
      'TEST_DATABASE_URL is required; native database tests must not silently skip',
    );
  const adminConfig = readDatabaseConfig({
    ...process.env,
    DATABASE_URL: process.env.TEST_DATABASE_URL,
  });
  assert.ok(adminConfig);
  admin = new Client(adminConfig);
  await admin.connect();
  // Only create/drop this uniquely named database, never reset the supplied database.
  await admin.query(`CREATE DATABASE "${databaseName}"`);
  created = true;
  const url = new URL(adminConfig.connectionString);
  url.pathname = `/${databaseName}`;
  config = { ...adminConfig, connectionString: url.toString() };
  pool = new Pool(config);
  database = new DatabaseService(config);
  assert.equal(await database.isReady(), false);
  await runMigrations(config, folder);
});

after(async () => {
  await database?.onApplicationShutdown();
  await pool?.end();
  if (created)
    await admin.query(`DROP DATABASE "${databaseName}" WITH (FORCE)`);
  await admin?.end();
});

test('migrations are repeatable without changing data or history', async () => {
  const [account] = await database.db.insert(accounts).values({}).returning();
  assert.ok(account);
  await runMigrations(config, folder);
  assert.equal(
    (
      await database.db
        .select()
        .from(accounts)
        .where(eq(accounts.id, account.id))
    ).length,
    1,
  );
  assert.equal(
    (await pool.query('SELECT * FROM drizzle.__drizzle_migrations')).rowCount,
    2,
  );
});

test('simultaneous claims for a username commit one account and roll back the loser', async () => {
  const claim = () =>
    database.db.transaction(async (tx) => {
      const [account] = await tx.insert(accounts).values({}).returning();
      assert.ok(account);
      await tx.insert(usernames).values({
        username: 'concurrent_name',
        accountId: account.id,
        isCurrent: true,
      });
      return account.id;
    });
  const beforeCount = await pool.query<{ count: string }>(
    'SELECT count(*) FROM accounts',
  );
  const results = await Promise.allSettled([claim(), claim()]);
  assert.equal(
    results.filter((result) => result.status === 'fulfilled').length,
    1,
  );
  assert.equal(
    results.filter((result) => result.status === 'rejected').length,
    1,
  );
  const afterCount = await pool.query<{ count: string }>(
    'SELECT count(*) FROM accounts',
  );
  assert.equal(
    Number(afterCount.rows[0]?.count),
    Number(beforeCount.rows[0]?.count) + 1,
  );
});

test('two accounts verifying the same phone cannot both acquire ownership', async () => {
  const inserted = await database.db
    .insert(accounts)
    .values([{}, {}])
    .returning();
  const outcomes = await Promise.allSettled(
    inserted.map((account) =>
      pool.query(
        "INSERT INTO verified_phones (account_id, phone_number) VALUES ($1, '+2348031234599')",
        [account.id],
      ),
    ),
  );
  assert.equal(
    outcomes.filter((result) => result.status === 'fulfilled').length,
    1,
  );
  assert.equal(
    outcomes.filter((result) => result.status === 'rejected').length,
    1,
  );
});

test('a second migration runner fails while a direct session holds the lock', async () => {
  const holder = await pool.connect();
  try {
    await holder.query('SELECT pg_advisory_lock($1)', [migrationLock]);
    await assert.rejects(runMigrations(config, folder), /Another migration/);
  } finally {
    await holder.query('SELECT pg_advisory_unlock($1)', [migrationLock]);
    holder.release();
  }
  await runMigrations(config, folder);
});

test('migration history tampering blocks migration and releases the session lock', async () => {
  const history = await pool.query<{ id: number; hash: string }>(
    'SELECT id, hash FROM drizzle.__drizzle_migrations ORDER BY id LIMIT 1',
  );
  const first = history.rows[0];
  assert.ok(first);
  try {
    await pool.query(
      'UPDATE drizzle.__drizzle_migrations SET hash = $1 WHERE id = $2',
      ['tampered', first.id],
    );
    await assert.rejects(
      runMigrations(config, folder),
      /Migration history differs/,
    );
  } finally {
    await pool.query(
      'UPDATE drizzle.__drizzle_migrations SET hash = $1 WHERE id = $2',
      [first.hash, first.id],
    );
  }
  await runMigrations(config, folder);
});

test('readiness fails when tables disappear and recovers when restored', async () => {
  assert.equal(await database.isReady(), true);
  await pool.query(
    'ALTER TABLE verified_phones RENAME TO temporarily_missing_phones',
  );
  try {
    assert.equal(await database.isReady(), false);
  } finally {
    await pool.query(
      'ALTER TABLE temporarily_missing_phones RENAME TO verified_phones',
    );
  }
  assert.equal(await database.isReady(), true);
});

test('API readiness is healthy with migrated PostgreSQL and closes its pool on shutdown', async () => {
  const module = await Test.createTestingModule({
    imports: [AppModule.forRoot(config)],
  }).compile();
  const app = module.createNestApplication<NestExpressApplication>({
    logger: false,
  });
  configureHttp(app, {
    nodeEnv: 'test',
    port: 8080,
    corsOrigins: [],
    database: config,
  });
  await app.init();
  try {
    const response = await request(
      app.getHttpServer() as Parameters<typeof request>[0],
    )
      .get('/api/v1/health/ready')
      .expect(200);
    assert.deepEqual(response.body, { status: 'ok' });
  } finally {
    await app.close();
  }
  assert.equal(await module.get(DatabaseService).isReady(), false);
});

test(
  'connection starvation returns not ready within the acquisition timeout',
  { timeout: 10000 },
  async () => {
    const limited = new DatabaseService({ ...config, max: 1 });
    let release!: () => void;
    let entered!: () => void;
    const barrier = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const transaction = limited.db.transaction(async () => {
      entered();
      await hold;
    });
    try {
      await barrier;
      const start = Date.now();
      assert.equal(await limited.isReady(), false);
      assert.ok(Date.now() - start < 4500);
    } finally {
      release();
      await transaction;
      await limited.onApplicationShutdown();
    }
  },
);
