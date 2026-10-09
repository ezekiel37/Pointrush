import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, test } from 'node:test';
import { sql } from 'drizzle-orm';
import * as s from '../src/database/schema.js';
import { AdminService } from '../src/admin/admin.service.js';
import { CampaignsService } from '../src/campaigns/campaigns.service.js';
import { ProfileEditsService } from '../src/profiles/profile-edits.service.js';
import { RatingsService } from '../src/sponsors/ratings.service.js';
import { campaignFixture } from './helpers/campaign-fixture.js';
import type { Identity } from './helpers/campaign-fixture.js';

const { pg, db, identity, business, campaign, travel } =
  await campaignFixture();
const ratings = new RatingsService(db);
const edits = new ProfileEditsService(db);
const admin = new AdminService(db);
const campaigns = new CampaignsService(db);
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
let phones = 0;
async function customer(name = 'Ada Okafor') {
  const who = await identity();
  phones += 1;
  await db.insert(s.verifiedPhones).values({
    accountId: who.account,
    phoneNumber: `+234812${String(phones).padStart(7, '0')}`,
  });
  await db
    .insert(s.accountProfiles)
    .values({ accountId: who.account, displayName: name });
  return who;
}
async function buy(shopper: Identity, run: { id: string; merchant: Identity }) {
  const code = await campaigns.activate(shopper.user, run.id);
  await campaigns.confirm(run.merchant.user, run.id, {
    id: randomUUID(),
    code: code.code,
    amountKobo: '500000',
  });
}

test('only verified customers the business served can rate, once', async () => {
  const owner = await business('Iya Basira Foods');
  const run = await campaign(5, '50000', owner);
  const handle = (await edits.mine(owner.user)).handle!;
  const served = await customer();
  const stranger = await customer('Tunde Bakare');
  const noPhone = await identity();
  await buy(served, run);
  assert.equal((await ratings.mine(stranger.user, handle)).canRate, false);
  assert.equal(
    await reason(ratings.rate(stranger.user, handle, { stars: 1 })),
    'rating_unavailable',
  );
  assert.equal(
    await reason(ratings.rate(noPhone.user, handle, { stars: 5 })),
    'rating_unavailable',
  );
  // The owner cannot rate their own business.
  assert.equal(
    await reason(ratings.rate(owner.user, handle, { stars: 5 })),
    'rating_unavailable',
  );
  assert.equal((await ratings.mine(served.user, handle)).canRate, true);
  await ratings.rate(served.user, handle, {
    stars: 4,
    comment: 'Good jollof, a bit slow at lunch.',
  });
  // Rating again within 48 hours updates the same rating.
  await ratings.rate(served.user, handle, {
    stars: 5,
    comment: 'Great jollof.',
  });
  const page = await edits.publicBusiness(handle);
  assert.ok(!('redirect' in page));
  if (!('redirect' in page)) {
    assert.equal(page.ratings.count, 1);
    assert.equal(page.ratings.average, 5);
    assert.equal(page.ratings.recent[0]!.by, 'Ada');
    assert.equal(page.ratings.recent[0]!.edited, true);
  }
  // After 48 hours it is fixed.
  await travel('49 hours');
  try {
    assert.equal(
      await reason(ratings.rate(served.user, handle, { stars: 1 })),
      'rating_locked',
    );
  } finally {
    await travel('0');
  }
  await assert.rejects(db.execute(sql`delete from business_ratings`));
});

test('ratings keep the business name at the time; replies and removals are fixed', async () => {
  const owner = await business('Chop Bar One');
  const run = await campaign(5, '50000', owner);
  const handle = (await edits.mine(owner.user)).handle!;
  const first = await customer('Kemi Adeyemi');
  await buy(first, run);
  await ratings.rate(first.user, handle, { stars: 2, comment: 'Cold food.' });
  // Renamed after an approved campaign: a reviewer approves it.
  const rename = {
    id: randomUUID(),
    field: 'name' as const,
    value: 'Chop Bar Two',
  };
  await edits.change(owner.user, rename);
  const staff = await customer('Reviewer Ray');
  await db.insert(s.taskReviewerGrants).values({
    reviewerId: staff.account,
    grantedBy: staff.account,
    reason: 'Ratings test',
    expiresAt: new Date(Date.now() + 3600000),
  });
  await admin.decideProfileChange(staff.user, rename.id, {
    decision: 'applied',
    reason: 'Rebrand',
  });
  const mine = await ratings.forBusiness(owner.user);
  const rating = mine.items[0]!;
  assert.equal(rating.businessNameThen, 'Chop Bar One');
  // The business replies once; it cannot edit the rating.
  await ratings.reply(owner.user, rating.id, {
    body: 'Sorry, we fixed our warmer.',
  });
  assert.equal(
    await reason(ratings.reply(owner.user, rating.id, { body: 'Again' })),
    'already_replied',
  );
  const other = await business('Someone Else');
  assert.equal(
    await reason(ratings.reply(other.user, rating.id, { body: 'Hijack' })),
    'reply_unavailable',
  );
  // Only a reviewer removes a rating, with a reason; it then stops counting.
  assert.equal(
    await reason(
      admin.removeRating(owner.user, rating.id, { reason: 'Unfair' }),
    ),
    403,
  );
  await admin.removeRating(staff.user, rating.id, {
    reason: 'Contains a phone number',
  });
  const after = await ratings.forBusiness(owner.user);
  assert.equal(after.summary.count, 0);
  assert.equal(after.items[0]!.removed, true);
  assert.equal(after.items[0]!.removedReason, 'Contains a phone number');
  assert.equal(after.items[0]!.reply?.body, 'Sorry, we fixed our warmer.');
  const recent = await admin.recentRatings(staff.user);
  assert.ok(recent.items.some((r) => r.id === rating.id && r.removed));
});
