import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, afterEach, test } from 'node:test';
import { and, eq } from 'drizzle-orm';
import * as s from '../src/database/schema.js';
import { CampaignsService } from '../src/campaigns/campaigns.service.js';
import { TaskWorkService } from '../src/tasks/task-work.service.js';
import {
  fundingBalance,
  postFundingTransfer,
} from '../src/funding/funding-ledger.js';
import { campaignFixture } from './helpers/campaign-fixture.js';

const fixture = await campaignFixture();
const { pg, db, identity, travel, campaign, draft, promotion } = fixture;
const campaigns = new CampaignsService(db);
after(() => pg.close());
afterEach(() => travel('0'));

async function available(account: string) {
  const [row] = await db
    .select()
    .from(s.fundingAccounts)
    .where(
      and(
        eq(s.fundingAccounts.ownerId, account),
        eq(s.fundingAccounts.bucket, 'available'),
      ),
    );
  return fundingBalance(db, row!.id);
}
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
const buy = async (task: string, owner: string) => {
  const shopper = await identity();
  const code = await campaigns.activate(shopper.user, task);
  const confirmed = await campaigns.confirm(owner, task, {
    id: randomUUID(),
    code: code.code,
    amountKobo: '500000',
  });
  return { shopper, confirmed };
};

test('a campaign cancelled before going live returns everything and can never go live', async () => {
  const run = await draft(undefined, 3, '50000');
  assert.equal(await available(run.merchant.account), 0n);
  const outsider = await identity();
  assert.equal(
    await reason(
      campaigns.returnFunds(outsider.user, run.id, { id: randomUUID() }),
    ),
    404,
  );
  const id = randomUUID();
  const returned = await campaigns.returnFunds(run.merchant.user, run.id, {
    id,
  });
  assert.equal(returned.amountKobo, '150000');
  // Retrying the same request returns the same result, not more money.
  assert.equal(
    (await campaigns.returnFunds(run.merchant.user, run.id, { id })).amountKobo,
    '150000',
  );
  assert.equal(await available(run.merchant.account), 150000n);
  assert.equal(await fundingBalance(db, run.allocation), 0n);
  assert.equal(
    await reason(
      campaigns.returnFunds(run.merchant.user, run.id, { id: randomUUID() }),
    ),
    'nothing_to_return',
  );
  // Its money is gone, so it can be neither approved nor published.
  await assert.rejects(run.decide('approved', 'Fine'));
  await assert.rejects(
    new TaskWorkService(db).publish(run.merchant.user, run.id),
  );
});

test('an approved campaign cancelled before publishing cannot be published', async () => {
  const run = await draft(undefined, 1, '50000');
  await run.decide('approved', 'Fine');
  await campaigns.returnFunds(run.merchant.user, run.id, { id: randomUUID() });
  assert.equal(
    await reason(new TaskWorkService(db).publish(run.merchant.user, run.id)),
    'campaign_cancelled',
  );
});

test('after a cash back offer ends, only money no shopper is owed comes back', async () => {
  const run = await campaign(4, '50000');
  const owner = run.merchant.user;
  const released = await buy(run.id, owner);
  const voided = await buy(run.id, owner);
  const owed = await buy(run.id, owner);
  await campaigns.voidPurchase(owner, voided.confirmed.id, {
    reason: 'Refunded',
  });
  assert.equal(
    await reason(campaigns.returnFunds(owner, run.id, { id: randomUUID() })),
    'funds_in_use',
  );
  await travel('3 days');
  await campaigns.release(released.shopper.user, released.confirmed.id);
  // Budget 200,000: 50,000 paid, 50,000 still owed to a shopper.
  const back = await campaigns.returnFunds(owner, run.id, { id: randomUUID() });
  assert.equal(back.amountKobo, '100000');
  assert.equal(await fundingBalance(db, run.allocation), 50000n);
  // The shopper who had not released yet is still paid in full.
  await campaigns.release(owed.shopper.user, owed.confirmed.id);
  assert.equal(await fundingBalance(db, run.allocation), 0n);
  assert.equal(
    await reason(campaigns.returnFunds(owner, run.id, { id: randomUUID() })),
    'nothing_to_return',
  );
});

test('after a prize promotion ends, unclaimed prize money comes back', async () => {
  const run = await promotion(3, '100000');
  assert.equal(
    await reason(
      campaigns.returnFunds(run.merchant.user, run.id, { id: randomUUID() }),
    ),
    'funds_in_use',
  );
  await travel('3 days');
  const back = await campaigns.returnFunds(run.merchant.user, run.id, {
    id: randomUUID(),
  });
  assert.equal(back.amountKobo, '300000');
});

test('returns cannot be forged or rewritten', async () => {
  const run = await draft(undefined, 1, '50000');
  const [locked] = await db
    .select()
    .from(s.fundingAccounts)
    .where(eq(s.fundingAccounts.id, run.allocation));
  const [avail] = await db
    .select()
    .from(s.fundingAccounts)
    .where(
      and(
        eq(s.fundingAccounts.ownerId, run.merchant.account),
        eq(s.fundingAccounts.bucket, 'available'),
      ),
    );
  await assert.rejects(
    postFundingTransfer(db, {
      id: randomUUID(),
      sourceId: locked!.id,
      destinationId: avail!.id,
      actorId: run.merchant.account,
      amountKobo: 50000n,
      kind: 'campaign_return',
      reference: `campaign-return:${randomUUID()}`,
      reason: 'Forged',
    }),
  );
  // The amount is computed by the database, whatever the caller supplies.
  await db.insert(s.campaignReturns).values({
    id: randomUUID(),
    taskId: run.id,
    actorId: run.merchant.account,
    amountKobo: 999999999n,
  });
  assert.equal(await available(run.merchant.account), 50000n);
  await assert.rejects(
    db
      .update(s.campaignReturns)
      .set({ amountKobo: 1n })
      .where(eq(s.campaignReturns.taskId, run.id)),
  );
});
