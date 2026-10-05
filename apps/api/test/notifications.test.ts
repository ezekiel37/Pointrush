import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, afterEach, test } from 'node:test';
import { CampaignsService } from '../src/campaigns/campaigns.service.js';
import { NotificationsService } from '../src/notifications/notifications.service.js';
import { campaignFixture } from './helpers/campaign-fixture.js';

const { pg, db, identity, travel, campaign, draft } = await campaignFixture();
const campaigns = new CampaignsService(db);
const notifications = new NotificationsService(db);
after(() => pg.close());
afterEach(() => travel('0'));

test('shoppers hear when cash back is ready or voided, and read state moves forward', async () => {
  const first = await campaign(1, '50000');
  const second = await campaign(1, '50000');
  const shopper = await identity();
  const stranger = await identity();
  const buy = async (run: { id: string; merchant: { user: string } }) => {
    const code = await campaigns.activate(shopper.user, run.id);
    return campaigns.confirm(run.merchant.user, run.id, {
      id: randomUUID(),
      code: code.code,
      amountKobo: '500000',
    });
  };
  const kept = await buy(first);
  const voided = await buy(second);
  await campaigns.voidPurchase(second.merchant.user, voided.id, {
    reason: 'Order refunded at the counter',
  });
  await travel('0');
  let feed = await notifications.list(shopper.user);
  assert.deepEqual(
    feed.items.map((i) => [i.kind, i.body]),
    [['cashback_voided', 'Order refunded at the counter']],
  );
  assert.equal(feed.unread, 1);
  assert.equal((await notifications.list(stranger.user)).items.length, 0);

  await notifications.markSeen(shopper.user);
  assert.equal((await notifications.list(shopper.user)).unread, 0);

  // After the hold, a ready notice appears and is unread.
  await travel('25 hours');
  feed = await notifications.list(shopper.user);
  assert.equal(feed.items[0]?.kind, 'cashback_ready');
  assert.equal(feed.items[0]?.title, '₦500 cash back is ready');
  assert.equal(feed.unread, 1);
  // Releasing it removes the notice: the feed follows the money.
  await campaigns.release(shopper.user, kept.id);
  feed = await notifications.list(shopper.user);
  assert.ok(!feed.items.some((i) => i.kind === 'cashback_ready'));
});

test('businesses hear about review decisions and money returned', async () => {
  const run = await draft(undefined, 1, '50000');
  await run.decide('changes_required', 'Add the street address.');
  await campaigns.returnFunds(run.merchant.user, run.id, { id: randomUUID() });
  const feed = await notifications.list(run.merchant.user);
  const kinds = feed.items.map((i) => i.kind);
  assert.ok(kinds.includes('review_changes_required'));
  assert.ok(kinds.includes('campaign_return'));
  assert.ok(kinds.includes('funding_confirmed'));
  const review = feed.items.find((i) => i.kind === 'review_changes_required');
  assert.equal(review?.title, '“Draft cash back” needs changes');
  assert.equal(review?.body, 'Add the street address.');
  assert.equal(review?.href, '/business/campaigns');
});
