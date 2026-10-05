import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, afterEach, test } from 'node:test';
import { and, eq } from 'drizzle-orm';
import * as s from '../src/database/schema.js';
import { CampaignsService } from '../src/campaigns/campaigns.service.js';
import { PromotionsService } from '../src/promotions/promotions.service.js';
import { StaffService } from '../src/sponsors/staff.service.js';
import { fundingBalance } from '../src/funding/funding-ledger.js';
import { campaignFixture } from './helpers/campaign-fixture.js';

const { pg, db, identity, travel, promotion } = await campaignFixture();
const promotions = new PromotionsService(db);
after(() => pg.close());
afterEach(() => travel('0'));

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
let phones = 0;
async function winner() {
  const person = await identity();
  await db.insert(s.verifiedPhones).values({
    accountId: person.account,
    phoneNumber: `+234807${String(++phones).padStart(7, '0')}`,
  });
  return person;
}

test('an item prize gives a voucher; handover returns the deposit, or the winner takes the cash', async () => {
  const run = await promotion(3, '200000', {
    mode: 'every_code_wins',
    permit: null,
    prize: { item: 'A crate of Fizz' },
  });
  const owner = run.merchant;
  const batch = await promotions.createBatch(owner.user, run.id, {
    id: randomUUID(),
    label: 'Crates',
    size: 3,
  });
  await promotions.activateBatch(owner.user, batch.batchId);
  const [ada, bola] = [await winner(), await winner()];
  const won = await promotions.claim(ada.user, {
    id: randomUUID(),
    code: batch.codes[0]!,
  });
  assert.equal(won.prizeItem, 'A crate of Fizz');
  assert.match(won.voucherCode!, /^[0-9A-F]{12}$/);
  assert.equal(won.voucherState, 'awaiting');
  assert.match(won.cashAvailableAt!, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  // Nothing reaches the wallet for an item prize.
  assert.equal(await balance(ada.account, 'reward_wallet'), 0n);

  // Only the real voucher, presented to this business, can be handed over.
  const stranger = await identity();
  assert.equal(
    await reason(
      promotions.handOver(owner.user, run.id, { code: '000000000000' }),
    ),
    'voucher_unknown',
  );
  assert.equal(
    await reason(
      promotions.handOver(stranger.user, run.id, { code: won.voucherCode }),
    ),
    'voucher_unknown',
  );
  const before = await balance(owner.account, 'available');
  // Staff at the till can hand it over; the code may be typed with spaces.
  const cashier = await identity();
  await db.insert(s.usernames).values({
    username: 'fizz_till',
    accountId: cashier.account,
    isCurrent: true,
  });
  const hired = await new StaffService(db).add(owner.user, {
    id: randomUUID(),
    username: 'fizz_till',
  });
  await new StaffService(db).accept(cashier.user, hired.items[0]!.id);
  assert.deepEqual(
    (await new StaffService(db).workplaces(cashier.user)).items[0]?.prizes,
    [{ id: run.id, title: 'Scratch and win', item: 'A crate of Fizz' }],
  );
  const spaced = `${won.voucherCode!.slice(0, 4)} ${won.voucherCode!.slice(4, 8)}-${won.voucherCode!.slice(8)}`;
  assert.deepEqual(
    await promotions.handOver(cashier.user, run.id, {
      code: spaced.toLowerCase(),
    }),
    {
      redemptionId: won.id,
      item: 'A crate of Fizz',
      handedOver: true,
    },
  );
  assert.equal(await balance(owner.account, 'available'), before + 200000n);
  assert.equal(
    await reason(
      promotions.handOver(owner.user, run.id, { code: won.voucherCode }),
    ),
    'prize_settled',
  );
  assert.equal(
    await reason(promotions.cashOut(ada.user, won.id)),
    'prize_settled',
  );
  assert.equal(
    (await promotions.claims(ada.user)).items[0]?.voucherState,
    'handed_over',
  );

  // Not handed over: after 14 days the winner may take the cash value.
  const late = await promotions.claim(bola.user, {
    id: randomUUID(),
    code: batch.codes[1]!,
  });
  assert.equal(
    await reason(promotions.cashOut(bola.user, late.id)),
    'cash_not_yet',
  );
  assert.equal(await reason(promotions.cashOut(ada.user, late.id)), 404);
  await travel('15 days');
  await promotions.cashOut(bola.user, late.id);
  assert.equal(await balance(bola.account, 'reward_wallet'), 200000n);
  assert.equal(
    await reason(
      promotions.handOver(owner.user, run.id, { code: late.voucherCode }),
    ),
    'prize_settled',
  );

  // After the end, the unclaimed prize's deposit returns; settled ones are gone.
  const back = await new CampaignsService(db).returnFunds(owner.user, run.id, {
    id: randomUUID(),
  });
  assert.equal(back.amountKobo, '200000');
});

test('an unsettled item voucher keeps its deposit locked after the promotion ends', async () => {
  const run = await promotion(2, '100000', {
    mode: 'every_code_wins',
    permit: null,
    prize: { item: 'Branded umbrella' },
  });
  const batch = await promotions.createBatch(run.merchant.user, run.id, {
    id: randomUUID(),
    label: 'Umbrellas',
    size: 2,
  });
  await promotions.activateBatch(run.merchant.user, batch.batchId);
  const person = await winner();
  const won = await promotions.claim(person.user, {
    id: randomUUID(),
    code: batch.codes[0]!,
  });
  await travel('3 days');
  const back = await new CampaignsService(db).returnFunds(
    run.merchant.user,
    run.id,
    { id: randomUUID() },
  );
  assert.equal(back.amountKobo, '100000');
  assert.equal(await fundingBalance(db, run.allocation), 100000n);
  // The winner can still collect the item, or later its cash value.
  await promotions.handOver(run.merchant.user, run.id, {
    code: won.voucherCode,
  });
  assert.equal(await fundingBalance(db, run.allocation), 0n);
});
