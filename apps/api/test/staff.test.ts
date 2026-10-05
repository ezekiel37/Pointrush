import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, test } from 'node:test';
import { sql } from 'drizzle-orm';
import * as s from '../src/database/schema.js';
import { CampaignsService } from '../src/campaigns/campaigns.service.js';
import { PromotionsService } from '../src/promotions/promotions.service.js';
import { StaffService } from '../src/sponsors/staff.service.js';
import { campaignFixture } from './helpers/campaign-fixture.js';

const { pg, db, identity, campaign, promotion } = await campaignFixture();
const campaigns = new CampaignsService(db);
const staff = new StaffService(db);
after(() => pg.close());

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
let names = 0;
async function named() {
  const person = await identity();
  const username = `staffer_${++names}`;
  await db
    .insert(s.usernames)
    .values({ username, accountId: person.account, isCurrent: true });
  return { ...person, username };
}

test('staff confirm purchases at the till but cannot void, earn or manage', async () => {
  const run = await campaign(3, '50000');
  const owner = run.merchant.user;
  const cashier = await named();
  const outsider = await identity();

  assert.equal(
    await reason(
      staff.add(owner, { id: randomUUID(), username: 'nobody_here' }),
    ),
    404,
  );
  assert.equal(
    await reason(
      staff.add(outsider.user, {
        id: randomUUID(),
        username: cashier.username,
      }),
    ),
    404,
  );
  const id = randomUUID();
  const added = await staff.add(owner, {
    id,
    username: `@${cashier.username.toUpperCase()}`,
  });
  assert.deepEqual(
    added.items.map((m) => m.username),
    [cashier.username],
  );
  // Retrying the same request does not add twice; a new request is refused.
  assert.equal(
    (await staff.add(owner, { id, username: cashier.username })).items.length,
    1,
  );
  assert.equal(
    await reason(
      staff.add(owner, { id: randomUUID(), username: cashier.username }),
    ),
    'staff_unavailable',
  );
  // Nothing changes for the cashier until they accept the invitation.
  const invited = await staff.workplaces(cashier.user);
  assert.equal(invited.items.length, 0);
  assert.deepEqual(
    invited.invitations.map((i) => i.id),
    [added.items[0]!.id],
  );
  assert.equal(
    await reason(staff.accept(outsider.user, added.items[0]!.id)),
    404,
  );
  await staff.accept(cashier.user, added.items[0]!.id);

  const shopper = await identity();
  const code = await campaigns.activate(shopper.user, run.id);
  const confirmed = await campaigns.confirm(cashier.user, run.id, {
    id: randomUUID(),
    code: code.code,
    amountKobo: '500000',
  });
  assert.equal(confirmed.cashbackKobo, '50000');
  assert.equal((await campaigns.summary(cashier.user, run.id)).confirmed, 1);
  // Voiding stays with the owner.
  assert.equal(
    await reason(
      campaigns.voidPurchase(cashier.user, confirmed.id, { reason: 'Mistake' }),
    ),
    404,
  );
  // Staff cannot earn cash back where they work, or manage staff.
  assert.equal(
    await reason(campaigns.activate(cashier.user, run.id)),
    'offer_unavailable',
  );
  assert.equal(await reason(staff.list(cashier.user)), 404);
  assert.deepEqual(
    (await staff.workplaces(cashier.user)).items.map((b) =>
      b.tills.map((t) => t.id),
    ),
    [[run.id]],
  );

  // Once removed, the till closes to them and they can shop like anyone else.
  await staff.remove(owner, added.items[0]!.id);
  assert.equal((await staff.list(owner)).items.length, 0);
  const next = await identity();
  const nextCode = await campaigns.activate(next.user, run.id);
  assert.equal(
    await reason(
      campaigns.confirm(cashier.user, run.id, {
        id: randomUUID(),
        code: nextCode.code,
        amountKobo: '500000',
      }),
    ),
    404,
  );
  assert.equal((await campaigns.activate(cashier.user, run.id)).taskId, run.id);
  assert.equal((await staff.workplaces(cashier.user)).items.length, 0);
  await assert.rejects(db.execute(sql`delete from business_staff_removals`));
});

test('staff cannot claim prizes from the business they work for', async () => {
  const run = await promotion(2, '100000', {
    mode: 'every_code_wins',
    permit: null,
  });
  const promotions = new PromotionsService(db);
  const batch = await promotions.createBatch(run.merchant.user, run.id, {
    id: randomUUID(),
    label: 'Crate',
    size: 2,
  });
  await promotions.activateBatch(run.merchant.user, batch.batchId);
  const worker = await named();
  await db.insert(s.verifiedPhones).values({
    accountId: worker.account,
    phoneNumber: '+2348099990001',
  });
  const hired = await staff.add(run.merchant.user, {
    id: randomUUID(),
    username: worker.username,
  });
  await staff.accept(worker.user, hired.items[0]!.id);
  assert.equal(
    await reason(
      promotions.claim(worker.user, {
        id: randomUUID(),
        code: batch.codes[0]!,
      }),
    ),
    'claim_rejected',
  );
});
