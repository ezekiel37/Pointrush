import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, test } from 'node:test';
import { sql } from 'drizzle-orm';
import * as s from '../src/database/schema.js';
import { AdminService } from '../src/admin/admin.service.js';
import { CampaignsService } from '../src/campaigns/campaigns.service.js';
import { PaymentsService } from '../src/payments/payments.service.js';
import { TestPaymentProvider } from '../src/payments/provider.js';
import { campaignFixture } from './helpers/campaign-fixture.js';

const { pg, db, identity, business, campaign } = await campaignFixture();
const admin = new AdminService(db);
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
async function appointed() {
  const person = await identity();
  await db.insert(s.taskReviewerGrants).values({
    reviewerId: person.account,
    grantedBy: person.account,
    reason: 'Admin test',
    expiresAt: new Date(Date.now() + 3600000),
  });
  return person;
}
let names = 0;
async function named() {
  const person = await identity();
  const username = `member_${++names}`;
  await db
    .insert(s.usernames)
    .values({ username, accountId: person.account, isCurrent: true });
  return { ...person, username };
}

test('only appointed reviewers can freeze, and every change is audited and reversible', async () => {
  const reviewer = await appointed();
  const target = await named();
  const ordinary = await identity();
  assert.equal(
    await reason(admin.findAccount(ordinary.user, target.username)),
    403,
  );
  const found = await admin.findAccount(reviewer.user, `@${target.username}`);
  assert.equal(found.accessState, 'active');
  assert.equal(
    await reason(admin.findAccount(reviewer.user, 'nobody_known')),
    404,
  );

  const freeze = {
    id: randomUUID(),
    toState: 'suspended',
    reason: 'Many accounts on one device',
  };
  const frozen = await admin.setAccess(reviewer.user, target.account, freeze);
  assert.equal(frozen.accessState, 'suspended');
  assert.deepEqual(
    frozen.history.map((h) => [h.fromState, h.toState, h.reason]),
    [['active', 'suspended', 'Many accounts on one device']],
  );
  // A retry changes nothing; the frozen person can no longer act.
  assert.equal(
    (await admin.setAccess(reviewer.user, target.account, freeze)).history
      .length,
    1,
  );
  const run = await campaign(1, '50000');
  assert.equal(
    await reason(new CampaignsService(db).activate(target.user, run.id)),
    403,
  );

  assert.equal(
    await reason(
      admin.setAccess(reviewer.user, reviewer.account, {
        id: randomUUID(),
        toState: 'suspended',
        reason: 'Self',
      }),
    ),
    'access_change_unavailable',
  );
  assert.equal(
    await reason(
      admin.setAccess(reviewer.user, target.account, {
        id: randomUUID(),
        toState: 'suspended',
        reason: 'Again',
      }),
    ),
    'access_change_unavailable',
  );
  // The reviewer who froze an account cannot unfreeze it alone.
  assert.equal(
    await reason(
      admin.setAccess(reviewer.user, target.account, {
        id: randomUUID(),
        toState: 'active',
        reason: 'Changed my mind',
      }),
    ),
    'access_change_unavailable',
  );
  const second = await appointed();
  const restored = await admin.setAccess(second.user, target.account, {
    id: randomUUID(),
    toState: 'active',
    reason: 'Explained: shared family phone',
  });
  assert.equal(restored.accessState, 'active');
  assert.equal(restored.history.length, 2);
  await assert.rejects(db.execute(sql`delete from account_access_changes`));
});

test('flagged payments can be noted once by a reviewer; notes move no money', async () => {
  const reviewer = await appointed();
  const merchant = await business('Flagged Foods');
  const provider = new TestPaymentProvider(
    'admin-test-secret-that-is-long-enough!',
  );
  const payments = new PaymentsService(db, provider);
  const intent = randomUUID();
  await payments.createFundingIntent(merchant.user, {
    id: intent,
    amountKobo: '500000',
  });
  const raw = JSON.stringify({
    id: 'evt_admin_1',
    type: 'collection.succeeded',
    data: { reference: intent, amount: '4000.00', currency: 'NGN' },
  });
  assert.equal(
    (
      await payments.handleWebhook('test', Buffer.from(raw), {
        'x-test-signature': provider.sign(raw),
      })
    ).outcome,
    'mismatch',
  );
  const flagged = await admin.flaggedPayments(reviewer.user);
  const event = flagged.items.find((e) => e.eventId === 'evt_admin_1')!;
  assert.equal(event.review, null);
  assert.equal(event.amountKobo, '400000');
  await admin.reviewPayment(reviewer.user, event.id, {
    note: 'Customer underpaid; provider refunded the ₦4,000.',
  });
  const after = await admin.flaggedPayments(reviewer.user);
  assert.equal(
    after.items.find((e) => e.id === event.id)?.review?.note,
    'Customer underpaid; provider refunded the ₦4,000.',
  );
  assert.equal(
    await reason(
      admin.reviewPayment(reviewer.user, event.id, { note: 'Twice' }),
    ),
    'payment_review_unavailable',
  );
  assert.equal(
    await reason(admin.flaggedPayments((await identity()).user)),
    403,
  );
});
