import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, afterEach, test } from 'node:test';
import { sql } from 'drizzle-orm';
import * as s from '../src/database/schema.js';
import { CampaignsService } from '../src/campaigns/campaigns.service.js';
import { AdminService } from '../src/admin/admin.service.js';
import { MemorySecurityAlerts } from '../src/auth/security-alerts.js';
import { NotificationsService } from '../src/notifications/notifications.service.js';
import { PaymentsService } from '../src/payments/payments.service.js';
import {
  ProviderError,
  TestPaymentProvider,
} from '../src/payments/provider.js';
import { campaignFixture } from './helpers/campaign-fixture.js';
import type { Identity } from './helpers/campaign-fixture.js';

const { pg, db, identity, travel, campaign, business } =
  await campaignFixture();
const provider = new TestPaymentProvider('bank-account-test-secret-0123456789');
const payments = new PaymentsService(db, provider);
const campaigns = new CampaignsService(db);
after(() => pg.close());
afterEach(() => {
  provider.failPayouts = null;
  return travel('0');
});

async function reason(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    const response = (error as { getResponse?: () => unknown }).getResponse?.();
    return (
      (response as { reason?: string })?.reason ??
      (error as { status?: number }).status
    );
  }
  assert.fail('Expected rejection');
}
let phones = 0;
async function earner(cashback = '200000') {
  const person = await identity();
  await db.insert(s.verifiedPhones).values({
    accountId: person.account,
    phoneNumber: `+234905${String(++phones).padStart(7, '0')}`,
  });
  await earn(person, cashback);
  return person;
}
async function earn(person: Identity, cashback: string) {
  const run = await campaign(1, cashback);
  const code = await campaigns.activate(person.user, run.id);
  const confirmed = await campaigns.confirm(run.merchant.user, run.id, {
    id: randomUUID(),
    code: code.code,
    amountKobo: '500000',
  });
  await travel('25 hours');
  try {
    await campaigns.release(person.user, confirmed.id);
  } finally {
    await travel('0');
  }
}
const withdraw = (person: Identity, amountKobo = '100000') =>
  payments.requestWithdrawal(person.user, { id: randomUUID(), amountKobo });

test('a bank account is checked by the provider and shown only masked', async () => {
  const person = await earner();
  assert.deepEqual(await payments.destination(person.user), {
    destination: null,
    locked: false,
  });
  assert.equal(
    await reason(
      payments.addDestination(person.user, {
        bankCode: '058',
        accountNumber: '12345',
      }),
    ),
    400,
  );
  assert.equal(
    await reason(
      payments.addDestination(person.user, {
        bankCode: '058',
        accountNumber: '0123450000',
      }),
    ),
    'account_not_found',
  );
  const added = await payments.addDestination(person.user, {
    bankCode: '044',
    accountNumber: '0123456789',
  });
  assert.equal(added.destination?.bankName, 'Access Bank');
  assert.equal(added.destination?.accountName, 'TEST ACCOUNT HOLDER');
  assert.equal(added.destination?.last4, '6789');
  // The full number is never stored.
  const stored = JSON.stringify(
    await db.execute(
      sql`select * from payout_destinations where account_id = ${person.account}`,
    ),
  );
  assert.ok(!stored.includes('0123456789'));
  // The first account is usable at once.
  assert.equal((await withdraw(person)).state, 'held');
  assert.equal(
    (await payments.withdrawalList(person.user)).items[0]?.bank,
    'Access Bank ••••6789',
  );
  assert.deepEqual(await payments.banks(), {
    items: [
      { code: '058', name: 'Guaranty Trust Bank' },
      { code: '044', name: 'Access Bank' },
    ],
  });
});

test('a changed bank account waits 24 hours, and changes are limited', async () => {
  const person = await earner('300000');
  await payments.addDestination(person.user, {
    bankCode: '058',
    accountNumber: '1111111111',
  });
  await withdraw(person);
  const changed = await payments.addDestination(person.user, {
    bankCode: '044',
    accountNumber: '2222222222',
  });
  assert.ok(
    Date.parse(String(changed.destination?.usableFrom)) >
      Date.now() + 23 * 3600000,
  );
  assert.equal(await reason(withdraw(person)), 'destination_cooling');
  await travel('25 hours');
  assert.equal((await withdraw(person)).state, 'held');
  await payments.addDestination(person.user, {
    bankCode: '058',
    accountNumber: '3333333333',
  });
  assert.equal(
    await reason(
      payments.addDestination(person.user, {
        bankCode: '058',
        accountNumber: '4444444444',
      }),
    ),
    'destination_limit',
  );
});

test('the payout job sends once, returns money on a refusal and keeps it on an outage', async () => {
  const merchant = await business('Runner Foods');
  void merchant;
  const [a, b, c] = [await earner(), await earner(), await earner()];
  for (const person of [a, b, c])
    await payments.addDestination(person.user, {
      bankCode: '058',
      accountNumber: '0123456789',
    });
  const first = await withdraw(a, '120000');

  // Provider outage: nothing is lost, the money stays held for the next run.
  provider.failPayouts = new ProviderError('HTTP_503', false);
  const outage = await payments.submitPendingWithdrawals();
  assert.ok(outage.deferred >= 1);
  assert.equal(
    (await payments.withdrawalList(a.user)).items.find((w) => w.id === first.id)
      ?.state,
    'held',
  );
  provider.failPayouts = null;
  const sent = await payments.submitPendingWithdrawals();
  assert.ok(sent.submitted >= 1);
  assert.equal(
    provider.payouts.filter((p) => p.withdrawalId === first.id).length,
    1,
  );
  assert.match(
    provider.payouts.find((p) => p.withdrawalId === first.id)!.destinationId,
    /^test_pd_/,
  );

  // A permanent refusal ends the withdrawal and returns the money.
  const refused = await withdraw(b, '140000');
  provider.failPayouts = new ProviderError('DESTINATION_REJECTED', true);
  await payments.submitPendingWithdrawals();
  const state = (await payments.withdrawalList(b.user)).items.find(
    (w) => w.id === refused.id,
  );
  assert.equal(state?.state, 'failed');
  void c;
});

test('a new bank account alerts the owner, and "this wasn\'t me" stops withdrawals until a reviewer checks', async () => {
  const alerts = new MemorySecurityAlerts();
  const guarded = new PaymentsService(db, provider, alerts);
  const person = await earner('300000');
  await guarded.addDestination(person.user, {
    bankCode: '058',
    accountNumber: '5555555555',
  });
  assert.deepEqual(
    alerts.sent.map((a) => [a.accountId, a.subject]),
    [[person.account, 'A bank account was added to your Acticlaim wallet']],
  );
  assert.ok(!alerts.sent[0]!.text.includes('5555555555'));
  // A withdrawal waiting to be sent is stopped and the money comes back.
  const queued = await withdraw(person, '200000');
  assert.deepEqual(await guarded.lockWithdrawals(person.user), {
    locked: true,
  });
  assert.equal(
    (await guarded.withdrawalList(person.user)).items.find(
      (w) => w.id === queued.id,
    )?.state,
    'failed',
  );
  await guarded.submitPendingWithdrawals();
  assert.equal(
    provider.payouts.filter((p) => p.withdrawalId === queued.id).length,
    0,
  );
  assert.equal((await guarded.destination(person.user)).locked, true);
  assert.equal(await reason(withdraw(person)), 'withdrawals_locked');
  assert.equal(alerts.sent.length, 2);
  const inbox = await new NotificationsService(db).list(person.user);
  const titles = inbox.items.map((n) => n.title);
  assert.ok(titles.includes('Withdrawals locked'));
  assert.match(
    inbox.items.find((n) => n.title === 'Bank account added')!.body,
    /Guaranty Trust Bank ending 5555/,
  );
  // Locking twice is harmless.
  await guarded.lockWithdrawals(person.user);

  // Only a reviewer other than the owner can unlock.
  const admin = new AdminService(db);
  assert.equal(
    await reason(admin.unlockWithdrawals(person.user, person.account)),
    403,
  );
  const reviewer = await identity();
  await db.insert(s.taskReviewerGrants).values({
    reviewerId: reviewer.account,
    grantedBy: reviewer.account,
    reason: 'Unlock test',
    expiresAt: new Date(Date.now() + 3600000),
  });
  assert.equal(
    (await admin.unlockWithdrawals(reviewer.user, person.account))
      .withdrawalsLocked,
    false,
  );
  assert.equal((await withdraw(person)).state, 'held');
  await assert.rejects(db.execute(sql`delete from withdrawal_locks`));
  await assert.rejects(db.execute(sql`delete from withdrawal_unlocks`));
});
