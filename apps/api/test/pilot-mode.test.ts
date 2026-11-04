import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, test } from 'node:test';
import { and, eq, sql } from 'drizzle-orm';
import * as s from '../src/database/schema.js';
import { AdminService } from '../src/admin/admin.service.js';
import { PaymentsService } from '../src/payments/payments.service.js';
import { TestPaymentProvider } from '../src/payments/provider.js';
import { PromotionsService } from '../src/promotions/promotions.service.js';
import { campaignFixture } from './helpers/campaign-fixture.js';

// Pilot mode: phone verification off for lack of an SMS provider. People can
// claim and withdraw without a phone, but every withdrawal waits for a
// reviewer; nothing reaches the bank without that approval.
const { pg, db, identity, promotion } = await campaignFixture();
const payments = new PaymentsService(
  db,
  new TestPaymentProvider('pilot-webhook-secret-long-enough-000000'),
);
const promotions = new PromotionsService(db);
const admin = new AdminService(db);
after(() => pg.close());

async function setting(path: string, value: string) {
  await db.execute(sql`
    insert into platform_settings (settings, reason)
    select jsonb_set(settings, ${`{${path}}`}::text[], ${value}::jsonb), 'Pilot test'
    from platform_settings order by version desc limit 1`);
}

async function reason(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    const response = (
      error as { getResponse?: () => { reason?: string } }
    ).getResponse?.();
    return response?.reason ?? (error as { status?: number }).status;
  }
  assert.fail('Expected rejection');
}

async function wallet(account: string) {
  const [row] = await db
    .select({ id: s.fundingAccounts.id })
    .from(s.fundingAccounts)
    .where(
      and(
        eq(s.fundingAccounts.ownerId, account),
        eq(s.fundingAccounts.bucket, 'reward_wallet'),
      ),
    );
  const [b] = (
    await db.execute(sql`
      select coalesce(sum(case when destination_id = ${row!.id} then amount_kobo else -amount_kobo end), 0)::text as v
      from funding_transfers where source_id = ${row!.id} or destination_id = ${row!.id}`)
  ).rows as { v: string }[];
  return BigInt(b!.v);
}

async function reviewer() {
  const who = await identity();
  await db.insert(s.taskReviewerGrants).values({
    reviewerId: who.account,
    grantedBy: who.account,
    reason: 'Pilot test',
    expiresAt: new Date(Date.now() + 3600000),
  });
  return who;
}

test('with phone verification off, people claim and withdraw, and a reviewer decides every payout', async () => {
  const person = await identity();
  const { id, merchant } = await promotion(2, '300000');
  const batch = await promotions.createBatch(merchant.user, id, {
    id: randomUUID(),
    label: 'Pilot crate',
    size: 2,
  });
  await promotions.activateBatch(merchant.user, batch.batchId);

  // Phone verification on (the default): no phone, no prize.
  assert.equal(
    await reason(
      promotions.claim(person.user, {
        id: randomUUID(),
        code: batch.codes[0]!,
      }),
    ),
    'phone_required',
  );

  await setting('phone', '{"required": false}');
  await promotions.claim(person.user, {
    id: randomUUID(),
    code: batch.codes[0]!,
  });
  assert.equal(await wallet(person.account), 300000n);
  await payments.addDestination(person.user, {
    bankCode: '058',
    accountNumber: '0123456789',
  });
  const approved = { id: randomUUID(), amountKobo: '100000' };
  const rejected = { id: randomUUID(), amountKobo: '150000' };
  assert.equal(
    (await payments.requestWithdrawal(person.user, approved)).state,
    'awaiting_approval',
  );
  await payments.requestWithdrawal(person.user, rejected);
  assert.equal(await wallet(person.account), 50000n);

  // Nothing is sent without approval.
  assert.equal((await payments.submitPendingWithdrawals()).submitted, 0);
  // And the database refuses to record it as sent.
  await assert.rejects(
    db.insert(s.withdrawalSubmissions).values({
      withdrawalId: approved.id,
      provider: 'test',
      providerPayoutId: 'sneaky',
    }),
  );

  const staff = await reviewer();
  const queue = await admin.pendingWithdrawals(staff.user);
  assert.deepEqual(
    queue.items.map((w) => w.id).sort(),
    [approved.id, rejected.id].sort(),
  );
  assert.equal(queue.items[0]!.phoneVerified, false);

  // A person who is not a reviewer cannot decide at all.
  assert.equal(
    await reason(
      admin.decideWithdrawal(person.user, approved.id, {
        decision: 'approved',
        reason: 'Mine',
      }),
    ),
    403,
  );

  await admin.decideWithdrawal(staff.user, approved.id, {
    decision: 'approved',
    reason: 'Known pilot customer',
  });
  await admin.decideWithdrawal(staff.user, rejected.id, {
    decision: 'rejected',
    reason: 'Same bank account as another pilot account',
  });
  // A decision cannot be changed afterwards.
  assert.equal(
    await reason(
      admin.decideWithdrawal(staff.user, approved.id, {
        decision: 'rejected',
        reason: 'Changed my mind',
      }),
    ),
    400,
  );
  assert.equal((await payments.submitPendingWithdrawals()).submitted, 1);
  // The rejected one came back to the wallet, with the reason shown.
  assert.equal(await wallet(person.account), 200000n);
  const list = await payments.withdrawalList(person.user);
  const back = list.items.find((w) => w.id === rejected.id)!;
  assert.equal(back.state, 'failed');
  assert.match(back.reason!, /Not approved: Same bank account/);
  assert.equal(list.items.find((w) => w.id === approved.id)!.state, 'sent');
  assert.equal((await admin.pendingWithdrawals(staff.user)).items.length, 0);

  // Phone verification back on: this unverified person can no longer
  // withdraw; approval stays a choice of its own.
  await setting('phone', '{"required": true}');
  assert.equal(
    await reason(
      payments.requestWithdrawal(person.user, {
        id: randomUUID(),
        amountKobo: '100000',
      }),
    ),
    'withdrawal_unavailable',
  );
});

test('a reviewer cannot approve their own withdrawal', async () => {
  await setting('phone', '{"required": false}');
  const { id, merchant } = await promotion(1, '200000');
  const batch = await promotions.createBatch(merchant.user, id, {
    id: randomUUID(),
    label: 'Staff crate',
    size: 1,
  });
  await promotions.activateBatch(merchant.user, batch.batchId);
  const staff = await reviewer();
  await promotions.claim(staff.user, {
    id: randomUUID(),
    code: batch.codes[0]!,
  });
  await payments.addDestination(staff.user, {
    bankCode: '058',
    accountNumber: '0123456780',
  });
  const mine = { id: randomUUID(), amountKobo: '100000' };
  await payments.requestWithdrawal(staff.user, mine);
  assert.equal(
    await reason(
      admin.decideWithdrawal(staff.user, mine.id, {
        decision: 'approved',
        reason: 'Looks fine to me',
      }),
    ),
    'withdrawal_approval_unavailable',
  );
  await setting('phone', '{"required": true}');
});
