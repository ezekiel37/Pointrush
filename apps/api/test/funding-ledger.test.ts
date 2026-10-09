import { lowLimits } from './helpers/settings.js';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { before, after, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { eq, sql } from 'drizzle-orm';
import * as schema from '../src/database/schema.js';
import {
  fundingBalance,
  FundingConflict,
  postFundingTransfer,
} from '../src/funding/funding-ledger.js';
import type { FundingCommand } from '../src/funding/funding-ledger.js';

const pg = new PGlite();
const db = drizzle(pg, { schema });
let clearing: string;
before(async () => {
  await migrate(db, { migrationsFolder: resolve('migrations') });
  await lowLimits(db);
  const [row] = await db
    .insert(schema.fundingAccounts)
    .values({ bucket: 'clearing' })
    .returning();
  clearing = row!.id;
});
after(async () => {
  await pg.close();
});
async function sponsor() {
  const [owner] = await db.insert(schema.accounts).values({}).returning();
  const [available] = await db
    .insert(schema.fundingAccounts)
    .values({ ownerId: owner!.id, bucket: 'available' })
    .returning();
  const credit: FundingCommand = {
    id: randomUUID(),
    sourceId: clearing,
    destinationId: available!.id,
    actorId: owner!.id,
    amountKobo: 5000000n,
    kind: 'funding_confirmed',
    reference: `test-provider:${randomUUID()}`,
    reason: 'Synthetic verified payment',
  };
  await postFundingTransfer(db, credit);
  return { owner: owner!.id, available: available!.id, credit };
}
async function allocation(ownerId: string) {
  const [row] = await db
    .insert(schema.fundingAccounts)
    .values({ bucket: 'task_locked', ownerId, allocationId: randomUUID() })
    .returning();
  return row!.id;
}
const lock = (
  sourceId: string,
  destinationId: string,
  actorId: string,
  amountKobo = 2000000n,
): FundingCommand => ({
  id: randomUUID(),
  sourceId,
  destinationId,
  actorId,
  amountKobo,
  kind: 'task_lock',
  reference: `allocation:${destinationId}`,
  reason: 'Task allocation',
});

test('50000 naira funded minus 20000 locked leaves 30000 available with balanced postings', async () => {
  const s = await sponsor();
  const destination = await allocation(s.owner);
  await postFundingTransfer(db, lock(s.available, destination, s.owner));
  assert.equal(await fundingBalance(db, s.available), 3000000n);
  assert.equal(await fundingBalance(db, destination), 2000000n);
});

test('same command and fresh UUID for the same provider reference credit once', async () => {
  const s = await sponsor();
  assert.equal((await postFundingTransfer(db, s.credit)).id, s.credit.id);
  assert.equal(
    (await postFundingTransfer(db, { ...s.credit, id: randomUUID() })).id,
    s.credit.id,
  );
  await assert.rejects(
    postFundingTransfer(db, { ...s.credit, amountKobo: 1n }),
    FundingConflict,
  );
  await assert.rejects(
    postFundingTransfer(db, { ...s.credit, reference: 'different' }),
    FundingConflict,
  );
  assert.equal(await fundingBalance(db, s.available), 5000000n);
});

test('retry of exhausted-balance lock succeeds without moving money again', async () => {
  const s = await sponsor();
  const destination = await allocation(s.owner);
  const command = lock(s.available, destination, s.owner, 5000000n);
  await postFundingTransfer(db, command);
  await postFundingTransfer(db, command);
  assert.equal(await fundingBalance(db, s.available), 0n);
  assert.equal(await fundingBalance(db, destination), 5000000n);
});

test('overspend rolls back allocation creation and transfer in the caller transaction', async () => {
  const s = await sponsor();
  const allocationId = randomUUID();
  await assert.rejects(
    db.transaction(async (tx) => {
      const [a] = await tx
        .insert(schema.fundingAccounts)
        .values({ bucket: 'task_locked', ownerId: s.owner, allocationId })
        .returning();
      await postFundingTransfer(
        tx,
        lock(s.available, a!.id, s.owner, 5000001n),
      );
    }),
  );
  assert.equal(
    (
      await db
        .select()
        .from(schema.fundingAccounts)
        .where(eq(schema.fundingAccounts.allocationId, allocationId))
    ).length,
    0,
  );
  assert.equal(await fundingBalance(db, s.available), 5000000n);
});

test('database rejects cross-sponsor locks, locked-fund spending and journal mutation', async () => {
  const a = await sponsor();
  const b = await sponsor();
  const destination = await allocation(b.owner);
  await assert.rejects(
    postFundingTransfer(db, lock(a.available, destination, a.owner)),
  );
  const own = await allocation(a.owner);
  const entry = await postFundingTransfer(db, lock(a.available, own, a.owner));
  await assert.rejects(
    postFundingTransfer(db, lock(own, a.available, a.owner, 1n)),
  );
  await assert.rejects(
    db
      .update(schema.fundingTransfers)
      .set({ amountKobo: 1n })
      .where(eq(schema.fundingTransfers.id, entry.id)),
  );
  await assert.rejects(
    db
      .delete(schema.fundingTransfers)
      .where(eq(schema.fundingTransfers.id, entry.id)),
  );
  await assert.rejects(
    db
      .update(schema.fundingAccounts)
      .set({ ownerId: b.owner })
      .where(eq(schema.fundingAccounts.id, own)),
  );
});

test('money rejects numeric coercion, zero, fractions, negatives and bigint overflow', async () => {
  const s = await sponsor();
  for (const amount of [
    0n,
    -1n,
    9223372036854775808n,
    1.5,
    '100',
    Number.MAX_SAFE_INTEGER,
  ]) {
    await assert.rejects(
      postFundingTransfer(db, {
        ...s.credit,
        id: randomUUID(),
        amountKobo: amount as bigint,
      }),
    );
  }
});

test('bigint amounts remain exact above JavaScript safe integer range', async () => {
  const s = await sponsor();
  const amount = 9007199254740993n;
  await postFundingTransfer(db, {
    ...s.credit,
    id: randomUUID(),
    reference: `test:${randomUUID()}`,
    amountKobo: amount,
  });
  assert.equal(await fundingBalance(db, s.available), amount + 5000000n);
});

test('inactive sponsors cannot lock funds and database rejects direct overdraft inserts', async () => {
  const s = await sponsor();
  const destination = await allocation(s.owner);
  await assert.rejects(
    db
      .insert(schema.fundingTransfers)
      .values(lock(s.available, destination, s.owner, 5000001n)),
  );
  await db
    .update(schema.accounts)
    .set({ accessState: 'suspended' })
    .where(eq(schema.accounts.id, s.owner));
  await assert.rejects(
    postFundingTransfer(db, lock(s.available, destination, s.owner)),
  );
  assert.equal(await fundingBalance(db, s.available), 5000000n);
});

test('journal cannot be truncated and unsupported isolation fails closed', async () => {
  const s = await sponsor();
  await assert.rejects(db.execute(sql`truncate funding_transfers`));
  await assert.rejects(
    db.transaction(
      async (tx) => {
        await postFundingTransfer(tx, {
          ...s.credit,
          id: randomUUID(),
          reference: `test:${randomUUID()}`,
        });
      },
      { isolationLevel: 'repeatable read' },
    ),
  );
});
