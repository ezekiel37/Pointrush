import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { after, before, test } from 'node:test';
import { Client, Pool } from 'pg';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../src/database/schema.js';
import { CampaignsService } from '../../src/campaigns/campaigns.service.js';
import { PromotionsService } from '../../src/promotions/promotions.service.js';
import { TaskWorkService } from '../../src/tasks/task-work.service.js';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { AccountsService } from '../../src/accounts/accounts.service.js';
import { AccountsRepository } from '../../src/accounts/accounts.repository.js';
import { AccountError } from '../../src/accounts/account.error.js';
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
import { AuthEmailBudget } from '../../src/auth/auth.email-budget.js';
import { authEmailBudgets } from '../../src/database/schema.js';
import { authEmailJobs } from '../../src/database/schema.js';
import { EmailWorker } from '../../src/auth/email-worker.js';
import { EmailPayloadCipher } from '../../src/auth/email-payload.js';
import { fundingAccounts } from '../../src/funding/funding.schema.js';
import {
  authUsers,
  authAccountLinks,
  sponsorTasks,
  taskReviewerGrants,
  taskReviews,
} from '../../src/database/schema.js';
import { TaskReviewService } from '../../src/reviews/task-review.service.js';
import { taskReviewChecklist } from '../../src/reviews/task-review.schema.js';
import { SponsorsService } from '../../src/sponsors/sponsors.service.js';
import {
  fundingBalance,
  postFundingTransfer,
} from '../../src/funding/funding-ledger.js';

const databaseName = `pointrush_test_${randomUUID().replaceAll('-', '')}`;
const folder = resolve('migrations');
let admin: Client;
let pool: Pool;
let database: DatabaseService;
let config: DatabaseConfig;
let created = false;

test('native duplicate task requests and competing reviews preserve one task and decision', async () => {
  const other = new DatabaseService(config);
  try {
    const authId = randomUUID();
    await database.db.insert(authUsers).values({
      id: authId,
      name: 'Native sponsor',
      email: `${authId}@example.test`,
      emailVerified: true,
    });
    const [owner] = await database.db.insert(accounts).values({}).returning();
    await database.db
      .insert(authAccountLinks)
      .values({ accountId: owner!.id, authUserId: authId });
    const service = new SponsorsService(database, 'test-v1');
    const profile = await service.createProfile(authId, {
      name: 'Native sponsor',
      acceptTerms: true,
      termsVersion: 'test-v1',
    });
    await database.db
      .insert(fundingAccounts)
      .values({ bucket: 'clearing' })
      .onConflictDoNothing();
    const [clearing] = await database.db
      .select()
      .from(fundingAccounts)
      .where(eq(fundingAccounts.bucket, 'clearing'));
    const [available] = await database.db
      .select()
      .from(fundingAccounts)
      .where(eq(fundingAccounts.ownerId, owner!.id));
    await postFundingTransfer(database.db, {
      id: randomUUID(),
      sourceId: clearing!.id,
      destinationId: available!.id,
      amountKobo: 200n,
      actorId: owner!.id,
      kind: 'funding_confirmed',
      reference: `test:${randomUUID()}`,
      reason: 'Native test',
    });
    const input = {
      requestId: randomUUID(),
      title: 'Test',
      instructions: 'Test instructions',
      proofRequirements: 'Document',
      rejectionCriteria: 'Copied work',
      model: 'selected_assignment',
      capacity: 2,
      rewardKobo: '100',
      startsAt: new Date(Date.now() + 86400000).toISOString(),
      endsAt: new Date(Date.now() + 172800000).toISOString(),
    };
    const results = await Promise.all([
      service.createTask(authId, input),
      new SponsorsService(other, 'test-v1').createTask(authId, input),
    ]);
    assert.equal(results[0].id, results[1].id);
    assert.equal(await fundingBalance(database.db, available!.id), 0n);
    assert.equal(
      await fundingBalance(database.db, results[0].allocationAccountId),
      200n,
    );
    assert.equal(
      (
        await database.db
          .select()
          .from(sponsorTasks)
          .where(eq(sponsorTasks.sponsorId, profile.id))
      ).length,
      1,
    );
    const reviewers = await database.db
      .insert(accounts)
      .values([{}, {}])
      .returning();
    await database.db.insert(taskReviewerGrants).values(
      reviewers.map((reviewer) => ({
        reviewerId: reviewer.id,
        grantedBy: owner!.id,
        reason: 'Native test only',
        expiresAt: new Date(Date.now() + 86400000),
      })),
    );
    const [task] = await database.db
      .select()
      .from(sponsorTasks)
      .where(eq(sponsorTasks.id, results[0].id));
    const decisions = await Promise.allSettled(
      reviewers.map((reviewer, i) =>
        new TaskReviewService(i === 0 ? database.db : other.db).decide(
          reviewer.id,
          {
            requestId: randomUUID(),
            taskId: task!.id,
            termsVersion: task!.termsVersion,
            termsHash: task!.requestHash,
            decision: i === 0 ? 'approved' : 'rejected',
            checklist: { ...taskReviewChecklist },
            reason: 'Native competing decision',
          },
        ),
      ),
    );
    assert.equal(
      decisions.filter((item) => item.status === 'fulfilled').length,
      1,
    );
    assert.equal(
      decisions.filter((item) => item.status === 'rejected').length,
      1,
    );
    const audits = await database.db
      .select()
      .from(taskReviews)
      .where(eq(taskReviews.taskId, task!.id));
    assert.equal(audits.length, 1);
    const [reviewed] = await database.db
      .select()
      .from(sponsorTasks)
      .where(eq(sponsorTasks.id, task!.id));
    assert.equal(reviewed!.reviewState, audits[0]!.decision);
    assert.equal(reviewed!.lifecycle, 'not_live');
    assert.equal(
      await fundingBalance(database.db, task!.allocationAccountId),
      200n,
    );
  } finally {
    await other.onApplicationShutdown();
  }
});

test('native concurrent allocations cannot overspend one sponsor balance', async () => {
  const other = new DatabaseService(config);
  try {
    const [owner] = await database.db.insert(accounts).values({}).returning();
    const [clearing] = await database.db
      .insert(fundingAccounts)
      .values({ bucket: 'clearing' })
      .onConflictDoNothing()
      .returning();
    const clearingId =
      clearing?.id ??
      (
        await database.db
          .select()
          .from(fundingAccounts)
          .where(eq(fundingAccounts.bucket, 'clearing'))
      )[0]!.id;
    const [available] = await database.db
      .insert(fundingAccounts)
      .values({ ownerId: owner!.id, bucket: 'available' })
      .returning();
    const destinations = await database.db
      .insert(fundingAccounts)
      .values(
        [0, 1].map(() => ({
          ownerId: owner!.id,
          bucket: 'task_locked',
          allocationId: randomUUID(),
        })),
      )
      .returning();
    await postFundingTransfer(database.db, {
      id: randomUUID(),
      sourceId: clearingId,
      destinationId: available!.id,
      amountKobo: 5000000n,
      actorId: owner!.id,
      kind: 'funding_confirmed',
      reference: `test:${randomUUID()}`,
      reason: 'Native test',
    });
    const outcomes = await Promise.allSettled(
      destinations.map((destination, i) =>
        postFundingTransfer(i === 0 ? database.db : other.db, {
          id: randomUUID(),
          sourceId: available!.id,
          destinationId: destination.id,
          amountKobo: 4000000n,
          actorId: owner!.id,
          kind: 'task_lock',
          reference: `test:${randomUUID()}`,
          reason: 'Native concurrent lock',
        }),
      ),
    );
    assert.equal(outcomes.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal(outcomes.filter((r) => r.status === 'rejected').length, 1);
    assert.equal(await fundingBalance(database.db, available!.id), 1000000n);
    assert.equal(
      (await fundingBalance(database.db, destinations[0]!.id)) +
        (await fundingBalance(database.db, destinations[1]!.id)),
      4000000n,
    );
  } finally {
    await other.onApplicationShutdown();
  }
});

test('two native workers claim a queued email only once while its lease is active', async () => {
  const other = new DatabaseService(config);
  const id = randomUUID();
  const key = 'a'.repeat(64);
  let sends = 0;
  try {
    await database.db.insert(authEmailJobs).values({
      id,
      expiresAt: new Date(Date.now() + 120000),
      payload: new EmailPayloadCipher(key).seal(id, {
        from: 'Acticlaim <sender@example.test>',
        to: 'user@example.test',
        subject: 'Test',
        text: 'Local only',
      }),
    });
    const send = async () => {
      sends++;
    };
    const outcomes = await Promise.all([
      new EmailWorker(database.db, key, send).runOne(),
      new EmailWorker(other.db, key, send).runOne(),
    ]);
    assert.equal(outcomes.filter((value) => value === 'accepted').length, 1);
    assert.equal(sends, 1);
  } finally {
    await other.onApplicationShutdown();
  }
});

test('independent pools cannot overspend the email budget or bypass recipient cooldown', async () => {
  const other = new DatabaseService(config);
  const secret = 'native-test-only-email-budget-secret';
  try {
    await database.db.delete(authEmailBudgets);
    const first = new AuthEmailBudget(database.db, secret, 5);
    const second = new AuthEmailBudget(other.db, secret, 5);
    const sameRecipient = await Promise.all([
      first.claim('same@example.test'),
      second.claim('SAME@example.test'),
    ]);
    assert.equal(sameRecipient.filter(Boolean).length, 1);
    const differentRecipients = await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        (index % 2 ? first : second).claim(`user${index}@example.test`),
      ),
    );
    assert.equal(differentRecipients.filter(Boolean).length, 4);
    const [global] = await database.db
      .select()
      .from(authEmailBudgets)
      .where(eq(authEmailBudgets.key, 'global'));
    assert.equal(global?.attempts, 5);
  } finally {
    await other.onApplicationShutdown();
  }
});

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
  // pool.end() resolves before every socket has closed; the teardown's forced
  // DROP DATABASE may then terminate a closing connection. Expected, not a failure.
  pool.on('error', () => undefined);
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
    readMigrationFiles({ migrationsFolder: folder }).length,
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

test('concurrent different renames on one account cannot bypass the cooldown', async () => {
  const service = new AccountsService(new AccountsRepository(database));
  const account = await service.create({
    username: 'race_original',
    displayName: 'Race',
  });
  const results = await Promise.allSettled([
    service.rename(account.id, { username: 'race_first' }),
    service.rename(account.id, { username: 'race_second' }),
  ]);
  assert.equal(
    results.filter((result) => result.status === 'fulfilled').length,
    1,
  );
  const failure = results.find((result) => result.status === 'rejected');
  assert.ok(
    failure?.status === 'rejected' && failure.reason instanceof AccountError,
  );
  assert.equal(failure.reason.code, 'USERNAME_CHANGE_TOO_SOON');
});

test('concurrent identical rename retries create only one history entry', async () => {
  const service = new AccountsService(new AccountsRepository(database));
  const account = await service.create({
    username: 'same_original',
    displayName: 'Same',
  });
  const results = await Promise.all([
    service.rename(account.id, { username: 'same_new' }),
    service.rename(account.id, { username: 'same_new' }),
  ]);
  assert.deepEqual(results[0], results[1]);
  assert.equal(
    (
      await database.db
        .select()
        .from(usernames)
        .where(eq(usernames.accountId, account.id))
    ).length,
    2,
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

test('native concurrent tills cannot exceed campaign capacity and concurrent releases pay once', async () => {
  const other = new DatabaseService(config);
  // Separate pools whose clock is shifted past the hold, via a test-only schema.
  const shifted = () =>
    new Pool({
      ...config,
      options:
        '-c search_path=test_clock,pg_catalog,public -c test.offset=PT25H',
    }).on('error', () => undefined);
  const later = [shifted(), shifted()];
  try {
    await pool.query(`
      CREATE SCHEMA IF NOT EXISTS test_clock;
      CREATE OR REPLACE FUNCTION test_clock.clock_timestamp() RETURNS timestamptz LANGUAGE sql VOLATILE AS
        $$ SELECT pg_catalog.clock_timestamp() + coalesce(nullif(current_setting('test.offset', true), ''), '0')::interval $$;
    `);
    const identity = async () => {
      const user = randomUUID();
      await database.db.insert(authUsers).values({
        id: user,
        name: 'Native',
        email: `${user}@example.test`,
        emailVerified: true,
      });
      const [account] = await database.db
        .insert(accounts)
        .values({})
        .returning();
      await database.db
        .insert(authAccountLinks)
        .values({ accountId: account!.id, authUserId: user });
      return { user, account: account!.id };
    };
    const merchant = await identity();
    const sponsors = new SponsorsService(database, 'test-v1');
    await sponsors.createProfile(merchant.user, {
      name: 'Native kiosk',
      acceptTerms: true,
      termsVersion: 'test-v1',
    });
    await database.db
      .insert(fundingAccounts)
      .values({ bucket: 'clearing' })
      .onConflictDoNothing();
    const [clearing] = await database.db
      .select()
      .from(fundingAccounts)
      .where(eq(fundingAccounts.bucket, 'clearing'));
    const [available] = await database.db
      .select()
      .from(fundingAccounts)
      .where(eq(fundingAccounts.ownerId, merchant.account));
    await postFundingTransfer(database.db, {
      id: randomUUID(),
      sourceId: clearing!.id,
      destinationId: available!.id,
      amountKobo: 5000n,
      actorId: merchant.account,
      kind: 'funding_confirmed',
      reference: `test:${randomUUID()}`,
      reason: 'Native test',
    });
    const start = new Date(Date.now() + 1000);
    const created = await sponsors.createTask(merchant.user, {
      requestId: randomUUID(),
      title: 'Native cash back',
      instructions: 'Buy and show your code',
      proofRequirements: 'Till confirmation',
      rejectionCriteria: 'Refunds',
      model: 'purchase_cashback',
      capacity: 1,
      rewardKobo: '5000',
      startsAt: start.toISOString(),
      endsAt: new Date(start.getTime() + 3 * 86400000).toISOString(),
      campaignTerms: {
        minSpendKobo: '0',
        holdHours: 24,
        placeName: 'Native kiosk',
        placeAddress: 'Test street',
      },
    });
    const [reviewer] = await database.db
      .insert(accounts)
      .values({})
      .returning();
    await database.db.insert(taskReviewerGrants).values({
      reviewerId: reviewer!.id,
      grantedBy: reviewer!.id,
      reason: 'Native test',
      expiresAt: new Date(Date.now() + 3600000),
    });
    const [row] = await database.db
      .select()
      .from(sponsorTasks)
      .where(eq(sponsorTasks.id, created.id));
    await new TaskReviewService(database.db).decide(reviewer!.id, {
      taskId: row!.id,
      requestId: randomUUID(),
      termsVersion: row!.termsVersion,
      termsHash: row!.requestHash,
      decision: 'approved',
      reason: 'Native approval',
      checklist: { ...taskReviewChecklist },
    });
    await new TaskWorkService(database.db).publish(merchant.user, created.id);
    await new Promise((r) => setTimeout(r, start.getTime() - Date.now() + 50));
    const shoppers = [await identity(), await identity()];
    const campaigns = new CampaignsService(database.db);
    const codes = await Promise.all(
      shoppers.map((shopper) => campaigns.activate(shopper.user, created.id)),
    );
    const outcomes = await Promise.allSettled(
      codes.map((code, i) =>
        new CampaignsService(i === 0 ? database.db : other.db).confirm(
          merchant.user,
          created.id,
          { id: randomUUID(), code: code.code, amountKobo: '100' },
        ),
      ),
    );
    const won = outcomes.filter((r) => r.status === 'fulfilled');
    assert.equal(won.length, 1);
    assert.equal(outcomes.filter((r) => r.status === 'rejected').length, 1);
    const confirmation = (won[0] as PromiseFulfilledResult<{ id: string }>)
      .value;
    const winner = shoppers[outcomes.indexOf(won[0]!)]!;
    await Promise.all(
      later.map((p) =>
        new CampaignsService(drizzle(p, { schema })).release(
          winner.user,
          confirmation.id,
        ),
      ),
    );
    const [wallet] = await database.db
      .select()
      .from(fundingAccounts)
      .where(eq(fundingAccounts.ownerId, winner.account));
    assert.equal(wallet?.bucket, 'reward_wallet');
    assert.equal(await fundingBalance(database.db, wallet!.id), 5000n);
    assert.equal(
      await fundingBalance(database.db, created.allocationAccountId),
      0n,
    );
  } finally {
    await Promise.all(later.map((p) => p.end()));
    await other.onApplicationShutdown();
  }
});

test('native simultaneous claims of one winning code pay exactly one person', async () => {
  const other = new DatabaseService(config);
  try {
    let phone = 0;
    const identity = async (verified = false) => {
      const user = randomUUID();
      await database.db.insert(authUsers).values({
        id: user,
        name: 'Native',
        email: `${user}@example.test`,
        emailVerified: true,
      });
      const [account] = await database.db
        .insert(accounts)
        .values({})
        .returning();
      await database.db
        .insert(authAccountLinks)
        .values({ accountId: account!.id, authUserId: user });
      if (verified)
        await database.db.insert(schema.verifiedPhones).values({
          accountId: account!.id,
          phoneNumber:
            `+23470${String(++phone).padStart(8, '0')}${Math.floor(Math.random() * 10)}`.slice(
              0,
              16,
            ),
        });
      return { user, account: account!.id };
    };
    const merchant = await identity();
    const sponsors = new SponsorsService(database, 'test-v1');
    await sponsors.createProfile(merchant.user, {
      name: 'Native drinks',
      acceptTerms: true,
      termsVersion: 'test-v1',
    });
    await database.db
      .insert(fundingAccounts)
      .values({ bucket: 'clearing' })
      .onConflictDoNothing();
    const [clearing] = await database.db
      .select()
      .from(fundingAccounts)
      .where(eq(fundingAccounts.bucket, 'clearing'));
    const [available] = await database.db
      .select()
      .from(fundingAccounts)
      .where(eq(fundingAccounts.ownerId, merchant.account));
    await postFundingTransfer(database.db, {
      id: randomUUID(),
      sourceId: clearing!.id,
      destinationId: available!.id,
      amountKobo: 7000n,
      actorId: merchant.account,
      kind: 'funding_confirmed',
      reference: `test:${randomUUID()}`,
      reason: 'Native test',
    });
    const start = new Date(Date.now() + 1000);
    const created = await sponsors.createTask(merchant.user, {
      requestId: randomUUID(),
      title: 'Native scratch and win',
      instructions: 'Scratch to reveal',
      proofRequirements: 'Winning code',
      rejectionCriteria: 'Invalid codes',
      model: 'claim_code',
      capacity: 1,
      rewardKobo: '7000',
      startsAt: start.toISOString(),
      endsAt: new Date(start.getTime() + 86400000).toISOString(),
      promotionTerms: {
        mode: 'every_code_wins',
        permit: null,
        claimLimitPerPerson: 1,
        howToGetCodes: 'One code in every crate',
      },
    });
    const [reviewer] = await database.db
      .insert(accounts)
      .values({})
      .returning();
    await database.db.insert(taskReviewerGrants).values({
      reviewerId: reviewer!.id,
      grantedBy: reviewer!.id,
      reason: 'Native test',
      expiresAt: new Date(Date.now() + 3600000),
    });
    const [row] = await database.db
      .select()
      .from(sponsorTasks)
      .where(eq(sponsorTasks.id, created.id));
    await new TaskReviewService(database.db).decide(reviewer!.id, {
      taskId: row!.id,
      requestId: randomUUID(),
      termsVersion: row!.termsVersion,
      termsHash: row!.requestHash,
      decision: 'approved',
      reason: 'Native approval',
      checklist: { ...taskReviewChecklist },
    });
    await new TaskWorkService(database.db).publish(merchant.user, created.id);
    await new Promise((r) => setTimeout(r, start.getTime() - Date.now() + 50));
    const promotions = new PromotionsService(database.db);
    const batch = await promotions.createBatch(merchant.user, created.id, {
      id: randomUUID(),
      label: 'Native crate',
      size: 1,
    });
    await promotions.activateBatch(merchant.user, batch.batchId);
    const people = [await identity(true), await identity(true)];
    const outcomes = await Promise.allSettled(
      people.map((person, i) =>
        new PromotionsService(i === 0 ? database.db : other.db).claim(
          person.user,
          { id: randomUUID(), code: batch.codes[0]! },
        ),
      ),
    );
    assert.equal(outcomes.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal(outcomes.filter((r) => r.status === 'rejected').length, 1);
    assert.equal(
      await fundingBalance(database.db, created.allocationAccountId),
      0n,
    );
    const wallets = await database.db
      .select()
      .from(fundingAccounts)
      .where(eq(fundingAccounts.bucket, 'reward_wallet'));
    let paid = 0n;
    for (const person of people) {
      const wallet = wallets.find((w) => w.ownerId === person.account);
      if (wallet) paid += await fundingBalance(database.db, wallet.id);
    }
    assert.equal(paid, 7000n);
  } finally {
    await other.onApplicationShutdown();
  }
});
