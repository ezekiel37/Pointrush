import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, test } from 'node:test';
import { and, eq } from 'drizzle-orm';
import * as s from '../src/database/schema.js';
import { CampaignsService } from '../src/campaigns/campaigns.service.js';
import { BillsService } from '../src/bills/bills.service.js';
import { TestBillProvider } from '../src/bills/provider.js';
import type { BillProvider, BillResult } from '../src/bills/provider.js';
import { fundingBalance } from '../src/funding/funding-ledger.js';
import { campaignFixture } from './helpers/campaign-fixture.js';
import type { Identity } from './helpers/campaign-fixture.js';

const fixture = await campaignFixture();
const { pg, db, identity, travel, campaign } = fixture;
const campaigns = new CampaignsService(db);
after(() => pg.close());

async function reason(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    const response = (error as { getResponse?: () => unknown }).getResponse?.();
    return (response as { reason?: string })?.reason ?? (error as Error).name;
  }
  assert.fail('Expected rejection');
}
async function wallet(account: string) {
  const [row] = await db
    .select()
    .from(s.fundingAccounts)
    .where(
      and(
        eq(s.fundingAccounts.ownerId, account),
        eq(s.fundingAccounts.bucket, 'reward_wallet'),
      ),
    );
  return row ? fundingBalance(db, row.id) : 0n;
}
let phones = 0;
// A shopper with a verified phone and ₦2,000 of released cash back.
async function earner(): Promise<Identity> {
  const shopper = await identity();
  await db.insert(s.verifiedPhones).values({
    accountId: shopper.account,
    phoneNumber: `+234803${String(++phones).padStart(7, '0')}`,
  });
  const { merchant, id } = await campaign(1, '200000');
  const code = await campaigns.activate(shopper.user, id);
  const confirmed = await campaigns.confirm(merchant.user, id, {
    id: randomUUID(),
    code: code.code,
    amountKobo: '450000',
  });
  await travel('25 hours');
  try {
    await campaigns.release(shopper.user, confirmed.id);
  } finally {
    await travel('0');
  }
  return shopper;
}
const airtime = (amountKobo = '50000', customerRef = '08031234567') => ({
  id: randomUUID(),
  kind: 'airtime',
  biller: 'mtn',
  customerRef,
  amountKobo,
});

test('without a provider, bill payments are off and nothing is held', async () => {
  const bills = new BillsService(db);
  assert.deepEqual(await bills.options(), { available: false, billers: [] });
  const person = await identity();
  await assert.rejects(bills.buy(person.user, airtime()), { status: 503 });
});

test('airtime is paid from the wallet once, even when the request is retried', async () => {
  const bills = new BillsService(db, new TestBillProvider());
  const shopper = await earner();
  const options = await bills.options();
  assert.equal(options.available, true);
  assert.ok(options.billers.some((b) => b.kind === 'data' && b.plans));

  const input = airtime('50000');
  const bought = await bills.buy(shopper.user, input);
  assert.equal(bought.state, 'delivered');
  assert.equal(await wallet(shopper.account), 150000n);
  // Same request again: same purchase, no second charge.
  assert.equal((await bills.buy(shopper.user, input)).id, bought.id);
  assert.equal(await wallet(shopper.account), 150000n);
  await assert.rejects(
    bills.buy(shopper.user, { ...input, amountKobo: '60000' }),
    { status: 409 },
  );
  const stranger = await earner();
  await assert.rejects(bills.buy(stranger.user, input), { status: 409 });
  const list = await bills.list(shopper.user);
  assert.equal(list.items.length, 1);
  assert.equal(list.items[0]?.customerRef, '08031234567');
});

test('a failed purchase returns the money; plans and numbers are checked', async () => {
  const bills = new BillsService(db, new TestBillProvider());
  const shopper = await earner();
  const failed = await bills.buy(shopper.user, airtime('50000', '08030000000'));
  assert.equal(failed.state, 'failed');
  assert.ok(failed.failure);
  assert.equal(await wallet(shopper.account), 200000n);

  assert.equal(
    await reason(bills.buy(shopper.user, airtime('50000', '12345678901'))),
    'invalid_phone',
  );
  assert.equal(
    await reason(
      bills.buy(shopper.user, {
        id: randomUUID(),
        kind: 'data',
        biller: 'mtn-data',
        customerRef: '08031234567',
        planCode: 'mtn-1gb-1d',
        amountKobo: '10000',
      }),
    ),
    'plan_changed',
  );
  const data = await bills.buy(shopper.user, {
    id: randomUUID(),
    kind: 'data',
    biller: 'mtn-data',
    customerRef: '08031234567',
    planCode: 'mtn-1gb-1d',
    amountKobo: '35000',
  });
  assert.equal(data.state, 'delivered');
  assert.equal(
    await reason(bills.buy(shopper.user, airtime('200000'))),
    'insufficient_balance',
  );
  assert.equal(
    await reason(bills.buy(shopper.user, airtime('4000'))),
    'amount_out_of_range',
  );
  // At most ₦50,000 a day, whatever the wallet holds.
  assert.equal(
    await reason(bills.buy(shopper.user, airtime('5000000'))),
    'bill_daily_limit',
  );
  assert.equal(await wallet(shopper.account), 165000n);
});

test('electricity shows the meter name first and keeps the token', async () => {
  const bills = new BillsService(db, new TestBillProvider());
  const shopper = await earner();
  const meter = {
    kind: 'electricity',
    biller: 'ikedc',
    customerRef: '45012345678',
  };
  assert.match((await bills.verify(shopper.user, meter)).name, /5678$/);
  const paid = await bills.buy(shopper.user, {
    ...meter,
    id: randomUUID(),
    amountKobo: '100000',
  });
  assert.equal(paid.state, 'delivered');
  assert.match(paid.token ?? '', /^\d{4}(-\d{4}){4}$/);
});

test('an unconfirmed purchase stays held until the provider answers', async () => {
  let answer: BillResult = { status: 'pending' };
  const base = new TestBillProvider();
  const provider: BillProvider = {
    name: 'test',
    billers: () => base.billers(),
    verifyCustomer: (i) => base.verifyCustomer(i),
    purchase: () => Promise.resolve(answer),
  };
  const bills = new BillsService(db, provider);
  const shopper = await earner();
  const pending = await bills.buy(shopper.user, airtime('50000'));
  assert.equal(pending.state, 'pending');
  assert.equal(await wallet(shopper.account), 150000n);
  answer = { status: 'delivered', providerRef: 'late' };
  await travel('2 minutes');
  try {
    assert.ok((await bills.settlePending()).checked >= 1);
  } finally {
    await travel('0');
  }
  assert.equal((await bills.list(shopper.user)).items[0]?.state, 'delivered');
  assert.equal(await wallet(shopper.account), 150000n);
});

test('bill payments need a verified phone and stop while money is locked', async () => {
  const bills = new BillsService(db, new TestBillProvider());
  const shopper = await earner();
  await db.insert(s.withdrawalLocks).values({
    id: randomUUID(),
    accountId: shopper.account,
    reason: 'This was not me',
  });
  assert.equal(
    await reason(bills.buy(shopper.user, airtime())),
    'withdrawals_locked',
  );
  const unverified = await identity();
  assert.equal(
    await reason(bills.buy(unverified.user, airtime())),
    'bill_unavailable',
  );
  // Ledger rows can never be rewritten.
  await assert.rejects(db.update(s.billPurchases).set({ amountKobo: 1n }));
});
