import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { before, after, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { eq } from 'drizzle-orm';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import * as schema from '../src/database/schema.js';
import { SponsorsService } from '../src/sponsors/sponsors.service.js';
import {
  fundingBalance,
  postFundingTransfer,
} from '../src/funding/funding-ledger.js';

const pg = new PGlite();
const db = drizzle(pg, { schema });
const service = new SponsorsService({ db }, 'test-v1');
const profileInput = {
  name: 'Test sponsor',
  acceptTerms: true,
  termsVersion: 'test-v1',
};
let clearing: string;
before(async () => {
  await migrate(db, { migrationsFolder: resolve('migrations') });
  clearing = (
    await db
      .insert(schema.fundingAccounts)
      .values({ bucket: 'clearing' })
      .returning()
  )[0]!.id;
});
after(async () => {
  await pg.close();
});
async function actor(verified = true) {
  const id = randomUUID();
  await db.insert(schema.authUsers).values({
    id,
    name: 'Test',
    email: `${id}@example.test`,
    emailVerified: verified,
  });
  const [account] = await db.insert(schema.accounts).values({}).returning();
  await db
    .insert(schema.authAccountLinks)
    .values({ accountId: account!.id, authUserId: id });
  return { id, accountId: account!.id };
}
async function fundedSponsor() {
  const user = await actor();
  const profile = await service.createProfile(user.id, profileInput);
  const [available] = await db
    .select()
    .from(schema.fundingAccounts)
    .where(eq(schema.fundingAccounts.ownerId, user.accountId));
  await postFundingTransfer(db, {
    id: randomUUID(),
    sourceId: clearing,
    destinationId: available!.id,
    actorId: user.accountId,
    amountKobo: 5000000n,
    kind: 'funding_confirmed',
    reference: `test:${randomUUID()}`,
    reason: 'Synthetic funding',
  });
  return { ...user, profile, available: available!.id };
}
function taskInput() {
  return {
    requestId: randomUUID(),
    title: 'Selected writing assignment',
    instructions: 'Write an original article',
    proofRequirements: 'Submit the article document',
    rejectionCriteria: 'Reject copied work',
    model: 'selected_assignment',
    capacity: 2,
    rewardKobo: '1000000',
    startsAt: new Date(Date.now() + 86400000).toISOString(),
    endsAt: new Date(Date.now() + 172800000).toISOString(),
  };
}

test('sponsor owns its profile, contact derives from verified identity and repeats are safe', async () => {
  const user = await actor();
  const profile = await service.createProfile(user.id, profileInput);
  assert.equal(profile.ownerId, user.accountId);
  assert.equal(profile.contactEmail, `${user.id}@example.test`);
  assert.equal(
    (await service.createProfile(user.id, profileInput)).id,
    profile.id,
  );
  await assert.rejects(
    service.createProfile(user.id, { ...profileInput, ownerId: randomUUID() }),
    BadRequestException,
  );
  await assert.rejects(
    service.createProfile(user.id, { ...profileInput, name: 'Different' }),
    ConflictException,
  );
});

test('onboarding requires configured current terms, acceptance and eligible account', async () => {
  const user = await actor();
  await assert.rejects(
    new SponsorsService({ db }).createProfile(user.id, profileInput),
    ServiceUnavailableException,
  );
  await assert.rejects(
    service.createProfile(user.id, { ...profileInput, termsVersion: 'old' }),
    ConflictException,
  );
  await assert.rejects(
    service.createProfile(user.id, { ...profileInput, acceptTerms: false }),
    BadRequestException,
  );
  const unverified = await actor(false);
  await assert.rejects(
    service.createProfile(unverified.id, profileInput),
    ForbiddenException,
  );
  await assert.rejects(
    service.createProfile(randomUUID(), profileInput),
    ForbiddenException,
  );
});

test('funded creation locks exact budget, binds allocation and remains private and unapproved', async () => {
  const sponsor = await fundedSponsor();
  const input = taskInput();
  const task = await service.createTask(sponsor.id, input);
  assert.equal(task.capacity, 2);
  assert.equal(task.budgetKobo, '2000000');
  assert.equal(task.reviewState, 'pending_review');
  assert.equal(task.lifecycle, 'not_live');
  assert.equal(await fundingBalance(db, sponsor.available), 3000000n);
  assert.equal(await fundingBalance(db, task.allocationAccountId), 2000000n);
  assert.equal((await service.createTask(sponsor.id, input)).id, task.id);
  assert.equal(await fundingBalance(db, sponsor.available), 3000000n);
  await assert.rejects(
    service.createTask(sponsor.id, { ...input, capacity: 1 }),
    ConflictException,
  );
  const stranger = await fundedSponsor();
  await assert.rejects(
    service.getTask(stranger.id, task.id),
    NotFoundException,
  );
  assert.equal((await service.getTask(sponsor.id, task.id)).id, task.id);
});

test('insufficient funds and invalid terms create neither a task nor allocation', async () => {
  const sponsor = await fundedSponsor();
  const before = (await db.select().from(schema.fundingAccounts)).length;
  await assert.rejects(
    service.createTask(sponsor.id, { ...taskInput(), capacity: 6 }),
    (error: ConflictException) =>
      (error.getResponse() as { reason?: string }).reason ===
      'insufficient_balance',
  );
  assert.equal((await db.select().from(schema.fundingAccounts)).length, before);
  assert.equal(
    (
      await db
        .select()
        .from(schema.sponsorTasks)
        .where(eq(schema.sponsorTasks.sponsorId, sponsor.profile.id))
    ).length,
    0,
  );
  for (const extra of [
    { budgetKobo: '1' },
    { reviewState: 'approved' },
    { ownerId: sponsor.accountId },
    { rewardKobo: 10 },
    { capacity: 0 },
    { model: 'shared_pool' },
    { startsAt: '2020-01-01T00:00:00Z' },
  ]) {
    await assert.rejects(
      service.createTask(sponsor.id, { ...taskInput(), ...extra }),
      BadRequestException,
    );
  }
});

test('transaction failure after locking rolls back both financial and task records', async () => {
  const sponsor = await fundedSponsor();
  await assert.rejects(
    db.transaction(async (tx) => {
      await new SponsorsService({ db: tx }, 'test-v1').createTask(
        sponsor.id,
        taskInput(),
      );
      throw new Error('Simulated failure before commit');
    }),
  );
  assert.equal(await fundingBalance(db, sponsor.available), 5000000n);
  assert.equal(
    (
      await db
        .select()
        .from(schema.sponsorTasks)
        .where(eq(schema.sponsorTasks.sponsorId, sponsor.profile.id))
    ).length,
    0,
  );
  assert.equal(
    (
      await db
        .select()
        .from(schema.fundingAccounts)
        .where(eq(schema.fundingAccounts.ownerId, sponsor.accountId))
    ).length,
    1,
  );
});

test('suspension blocks new tasks and stored task terms cannot be edited or published', async () => {
  const sponsor = await fundedSponsor();
  const task = await service.createTask(sponsor.id, {
    ...taskInput(),
    model: 'capped_fixed',
    capacity: 1,
  });
  await assert.rejects(
    db
      .update(schema.sponsorTasks)
      .set({ lifecycle: 'live', reviewState: 'approved' })
      .where(eq(schema.sponsorTasks.id, task.id)),
  );
  await assert.rejects(
    db
      .update(schema.sponsorProfiles)
      .set({ ownerId: randomUUID() })
      .where(eq(schema.sponsorProfiles.id, sponsor.profile.id)),
  );
  await db
    .update(schema.accounts)
    .set({ accessState: 'suspended' })
    .where(eq(schema.accounts.id, sponsor.accountId));
  await assert.rejects(
    service.createTask(sponsor.id, taskInput()),
    ForbiddenException,
  );
});

test('database rejects a task referencing another allocation or an unfunded allocation', async () => {
  const sponsor = await fundedSponsor();
  const task = await service.createTask(sponsor.id, taskInput());
  const [stored] = await db
    .select()
    .from(schema.sponsorTasks)
    .where(eq(schema.sponsorTasks.id, task.id));
  const id = randomUUID();
  const [empty] = await db
    .insert(schema.fundingAccounts)
    .values({
      ownerId: sponsor.accountId,
      bucket: 'task_locked',
      allocationId: id,
    })
    .returning();
  await assert.rejects(
    db.insert(schema.sponsorTasks).values({
      ...stored!,
      id,
      requestId: randomUUID(),
      allocationAccountId: empty!.id,
    }),
  );
  await assert.rejects(
    db
      .insert(schema.sponsorTasks)
      .values({ ...stored!, id: randomUUID(), requestId: randomUUID() }),
  );
});

test('with jobs switched off, paid tasks cannot be created and no money is locked', async () => {
  const sponsor = await fundedSponsor();
  const launch = new SponsorsService({ db }, 'test-v1', false);
  await assert.rejects(launch.createTask(sponsor.id, taskInput()), (error) => {
    const response = (
      error as { getResponse: () => { reason?: string } }
    ).getResponse();
    return response.reason === 'jobs_unavailable';
  });
  assert.equal(await fundingBalance(db, sponsor.available), 5000000n);
});
