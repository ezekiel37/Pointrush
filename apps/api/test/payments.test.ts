import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, test } from 'node:test';
import { and, eq, sql } from 'drizzle-orm';
import * as s from '../src/database/schema.js';
import { CampaignsService } from '../src/campaigns/campaigns.service.js';
import { PaymentsService } from '../src/payments/payments.service.js';
import {
  decimalToKobo,
  InvalidWebhook,
  TestPaymentProvider,
} from '../src/payments/provider.js';
import {
  fundingBalance,
  postFundingTransfer,
} from '../src/funding/funding-ledger.js';
import { campaignFixture } from './helpers/campaign-fixture.js';
import type { Identity } from './helpers/campaign-fixture.js';

const secret = 'test-webhook-secret-that-is-long-enough-0123';
const { pg, db, identity, travel, business, campaign } =
  await campaignFixture();
const provider = new TestPaymentProvider(secret);
const payments = new PaymentsService(db, provider);
const campaigns = new CampaignsService(db);
after(() => pg.close());

function deliver(
  body: Record<string, unknown>,
  options: {
    signWith?: TestPaymentProvider;
    timestamp?: number;
    tamper?: boolean;
  } = {},
) {
  const raw = JSON.stringify(body);
  const signature = (options.signWith ?? provider).sign(raw, options.timestamp);
  return payments.handleWebhook(
    'test',
    Buffer.from(options.tamper ? raw.replace('00', '99') : raw),
    { 'x-test-signature': signature },
  );
}
async function balance(owner: string, bucket: string) {
  const [row] = await db
    .select()
    .from(s.fundingAccounts)
    .where(
      and(
        eq(s.fundingAccounts.ownerId, owner),
        eq(s.fundingAccounts.bucket, bucket),
      ),
    );
  return row ? fundingBalance(db, row.id) : 0n;
}
async function reason(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    const response = (error as { getResponse?: () => unknown }).getResponse?.();
    return (response as { reason?: string })?.reason ?? (error as Error).name;
  }
  assert.fail('Expected rejection');
}
let phones = 0;
async function verifiedPerson() {
  const person = await identity();
  phones += 1;
  await db.insert(s.verifiedPhones).values({
    accountId: person.account,
    phoneNumber: `+234810${String(phones).padStart(7, '0')}`,
  });
  await payments.addDestination(person.user, {
    bankCode: '058',
    accountNumber: '0123456789',
  });
  return person;
}
// Gives a person a real wallet balance through the cash back flow.
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

test('decimal amounts convert to exact kobo', () => {
  assert.equal(decimalToKobo('5000.00'), 500000n);
  assert.equal(decimalToKobo('0.5'), 50n);
  assert.equal(decimalToKobo('12'), 1200n);
  assert.equal(decimalToKobo('1.234'), null);
  assert.equal(decimalToKobo('-1.00'), null);
});

test('payments are unavailable without a configured provider', async () => {
  const merchant = await business('No Provider Co');
  const none = new PaymentsService(db);
  assert.equal(
    await reason(
      none.createFundingIntent(merchant.user, {
        id: randomUUID(),
        amountKobo: '500000',
      }),
    ),
    'payments_unavailable',
  );
  const person = await identity();
  assert.equal(
    await reason(
      none.requestWithdrawal(person.user, {
        id: randomUUID(),
        amountKobo: '50000',
      }),
    ),
    'payments_unavailable',
  );
});

test('business funding credits only a verified, matching, first-seen confirmation', async () => {
  const merchant = await business('Funded Foods');
  const shopper = await identity();
  await assert.rejects(
    payments.createFundingIntent(shopper.user, {
      id: randomUUID(),
      amountKobo: '500000',
    }),
    { status: 404 },
  );
  await assert.rejects(
    payments.createFundingIntent(merchant.user, {
      id: randomUUID(),
      amountKobo: '99',
    }),
    { status: 400 },
  );
  const intentId = randomUUID();
  const intent = await payments.createFundingIntent(merchant.user, {
    id: intentId,
    amountKobo: '500000',
  });
  assert.match(intent.checkoutUrl, /^https:\/\//);
  assert.equal(
    await reason(
      payments.createFundingIntent(merchant.user, {
        id: intentId,
        amountKobo: '500000',
      }),
    ),
    'checkout_started',
  );

  const paid = {
    id: 'evt_1',
    type: 'collection.succeeded',
    data: { reference: intentId, amount: '5000.00', currency: 'NGN' },
  };
  // Forged, stale and tampered deliveries never reach the ledger.
  await assert.rejects(
    deliver(paid, {
      signWith: new TestPaymentProvider(
        'another-secret-that-is-also-long-0000',
      ),
    }),
    InvalidWebhook,
  );
  await assert.rejects(
    deliver(paid, { timestamp: Math.floor(Date.now() / 1000) - 600 }),
    InvalidWebhook,
  );
  await assert.rejects(deliver(paid, { tamper: true }), InvalidWebhook);
  await assert.rejects(
    payments.handleWebhook('test', Buffer.from('{}'), {}),
    InvalidWebhook,
  );
  assert.equal(await balance(merchant.account, 'available'), 0n);

  assert.deepEqual(await deliver(paid), {
    outcome: 'credited',
    duplicate: false,
  });
  assert.deepEqual(await deliver(paid), {
    outcome: 'credited',
    duplicate: true,
  });
  // A provider retry with a new event ID still credits only once.
  assert.equal((await deliver({ ...paid, id: 'evt_2' })).outcome, 'credited');
  assert.equal(await balance(merchant.account, 'available'), 500000n);

  const short = randomUUID();
  await payments.createFundingIntent(merchant.user, {
    id: short,
    amountKobo: '1000000',
  });
  assert.equal(
    (
      await deliver({
        id: 'evt_3',
        type: 'collection.succeeded',
        data: { reference: short, amount: '9000.00', currency: 'NGN' },
      })
    ).outcome,
    'mismatch',
  );
  assert.equal(
    (
      await deliver({
        id: 'evt_4',
        type: 'collection.succeeded',
        data: { reference: short, amount: '10000.00', currency: 'USD' },
      })
    ).outcome,
    'mismatch',
  );
  assert.equal(
    (
      await deliver({
        id: 'evt_5',
        type: 'collection.succeeded',
        data: { reference: randomUUID(), amount: '1.00', currency: 'NGN' },
      })
    ).outcome,
    'unknown_reference',
  );
  assert.equal(
    (await deliver({ id: 'evt_6', type: 'customer.updated' })).outcome,
    'ignored',
  );
  assert.equal(await balance(merchant.account, 'available'), 500000n);

  // Even a direct ledger write cannot credit more than the intent.
  const [clearing] = await db
    .select()
    .from(s.fundingAccounts)
    .where(eq(s.fundingAccounts.bucket, 'clearing'));
  const [available] = await db
    .select()
    .from(s.fundingAccounts)
    .where(
      and(
        eq(s.fundingAccounts.ownerId, merchant.account),
        eq(s.fundingAccounts.bucket, 'available'),
      ),
    );
  await assert.rejects(
    postFundingTransfer(db, {
      id: randomUUID(),
      sourceId: clearing!.id,
      destinationId: available!.id,
      actorId: merchant.account,
      amountKobo: 9000000n,
      kind: 'funding_confirmed',
      reference: `intent:${short}`,
      reason: 'Forged',
    }),
  );
  await assert.rejects(
    db.execute(
      sql`update funding_intents set amount_kobo = 1 where id = ${short}`,
    ),
  );
  await assert.rejects(
    db.execute(sql`delete from payment_events where event_id = 'evt_1'`),
  );
});

test('withdrawals hold money at once, pay out once and return on failure', async () => {
  const unverified = await identity();
  // No bank account yet: asked to add one first.
  assert.equal(
    await reason(
      payments.requestWithdrawal(unverified.user, {
        id: randomUUID(),
        amountKobo: '100000',
      }),
    ),
    'destination_required',
  );
  await payments.addDestination(unverified.user, {
    bankCode: '058',
    accountNumber: '0123456789',
  });
  await earn(unverified, '160000');
  assert.equal(
    await reason(
      payments.requestWithdrawal(unverified.user, {
        id: randomUUID(),
        amountKobo: '100000',
      }),
    ),
    'withdrawal_unavailable',
  );

  const person = await verifiedPerson();
  await earn(person, '400000');
  assert.equal(await balance(person.account, 'reward_wallet'), 400000n);
  await assert.rejects(
    payments.requestWithdrawal(person.user, {
      id: randomUUID(),
      amountKobo: '100',
    }),
    { status: 400 },
  );
  assert.equal(
    await reason(
      payments.requestWithdrawal(person.user, {
        id: randomUUID(),
        amountKobo: '600000',
      }),
    ),
    'insufficient_balance',
  );
  const first = { id: randomUUID(), amountKobo: '240000' };
  assert.equal(
    (await payments.requestWithdrawal(person.user, first)).state,
    'held',
  );
  assert.equal(
    (await payments.requestWithdrawal(person.user, first)).id,
    first.id,
  );
  assert.equal(await balance(person.account, 'reward_wallet'), 160000n);
  assert.equal(await balance(person.account, 'payout_hold'), 240000n);
  // The held money cannot be withdrawn again.
  assert.equal(
    await reason(
      payments.requestWithdrawal(person.user, {
        id: randomUUID(),
        amountKobo: '200000',
      }),
    ),
    'insufficient_balance',
  );
  const second = { id: randomUUID(), amountKobo: '100000' };
  await payments.requestWithdrawal(person.user, second);

  assert.equal(
    (await payments.submitPendingWithdrawals()).submitted >= 2,
    true,
  );
  assert.equal((await payments.submitPendingWithdrawals()).submitted, 0);
  assert.equal(
    provider.payouts.filter((p) => p.withdrawalId === first.id).length,
    1,
  );

  assert.equal(
    (
      await deliver({
        id: 'po_1',
        type: 'payout.succeeded',
        data: { reference: first.id, amount: '999.00' },
      })
    ).outcome,
    'mismatch',
  );
  assert.equal(
    (
      await deliver({
        id: 'po_2',
        type: 'payout.succeeded',
        data: { reference: first.id, amount: '2400.00' },
      })
    ).outcome,
    'payout_paid',
  );
  assert.equal(
    (
      await deliver({
        id: 'po_3',
        type: 'payout.failed',
        data: { reference: second.id, amount: '1000.00' },
      })
    ).outcome,
    'payout_failed',
  );
  // A late contradictory event cannot reverse a settled withdrawal.
  assert.equal(
    (
      await deliver({
        id: 'po_4',
        type: 'payout.failed',
        data: { reference: first.id, amount: '2400.00' },
      })
    ).outcome,
    'mismatch',
  );
  assert.equal(
    (
      await deliver({
        id: 'po_5',
        type: 'payout.succeeded',
        data: { reference: first.id, amount: '2400.00' },
      })
    ).outcome,
    'payout_paid',
  );
  assert.equal(await balance(person.account, 'payout_hold'), 0n);
  assert.equal(await balance(person.account, 'reward_wallet'), 160000n);
  const list = await payments.withdrawalList(person.user);
  assert.deepEqual(
    list.items.map((w) => [w.id, w.state]).sort(),
    [
      [first.id, 'paid'],
      [second.id, 'failed'],
    ].sort(),
  );
  await assert.rejects(
    db
      .insert(s.withdrawalOutcomes)
      .values({ withdrawalId: first.id, outcome: 'failed', reason: 'Forged' }),
  );
  await assert.rejects(
    db.execute(
      sql`update withdrawals set amount_kobo = 1 where id = ${first.id}`,
    ),
  );
});

test('a person can request at most three withdrawals a day', async () => {
  const person = await verifiedPerson();
  await earn(person, '600000');
  for (let i = 0; i < 3; i++)
    await payments.requestWithdrawal(person.user, {
      id: randomUUID(),
      amountKobo: '100000',
    });
  assert.equal(
    await reason(
      payments.requestWithdrawal(person.user, {
        id: randomUUID(),
        amountKobo: '100000',
      }),
    ),
    'withdrawal_daily_limit',
  );
  assert.equal(await balance(person.account, 'reward_wallet'), 300000n);
});
