import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, test } from 'node:test';
import { and, eq, sql } from 'drizzle-orm';
import * as s from '../src/database/schema.js';
import { AdminService } from '../src/admin/admin.service.js';
import { AccountsRepository } from '../src/accounts/accounts.repository.js';
import { AccountsService } from '../src/accounts/accounts.service.js';
import { CampaignsService } from '../src/campaigns/campaigns.service.js';
import { ReferralsService } from '../src/referrals/referrals.service.js';
import { defaultSettings } from '../src/settings/settings.js';
import type { Settings } from '../src/settings/settings.js';
import { campaignFixture } from './helpers/campaign-fixture.js';
import type { Identity } from './helpers/campaign-fixture.js';

const { pg, db, identity, business, campaign, travel, fund } =
  await campaignFixture();
const admin = new AdminService(db);
const campaigns = new CampaignsService(db);
const referrals = new ReferralsService(db);
const accounts = new AccountsService(new AccountsRepository({ db }));
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

// Referral cash on, small campaign floors so tests can use small amounts.
function settings(change: (s: Settings) => void = () => undefined) {
  const next = structuredClone(defaultSettings);
  next.funding.minKobo = 10000;
  next.campaigns.minCashbackKobo = 1;
  next.campaigns.minBudgetKobo = 1;
  next.newBusinesses.days = 0;
  change(next);
  return next;
}
async function install(value: Settings) {
  await db
    .insert(s.platformSettings)
    .values({ settings: value, reason: 'Test' });
}
await install(settings());

let phones = 0;
async function verified(person?: Identity) {
  const who = person ?? (await identity());
  phones += 1;
  await db.insert(s.verifiedPhones).values({
    accountId: who.account,
    phoneNumber: `+234811${String(phones).padStart(7, '0')}`,
  });
  return who;
}
async function invite(referrer: Identity, referee: Identity) {
  await db
    .insert(s.referrals)
    .values({ refereeId: referee.account, referrerId: referrer.account });
}
async function wallet(account: string) {
  const [row] = (
    await db.execute(sql`
      select coalesce(sum(case when f.destination_id = a.id then f.amount_kobo else -f.amount_kobo end), 0)::text as b
      from funding_accounts a join funding_transfers f on f.source_id = a.id or f.destination_id = a.id
      where a.owner_id = ${account} and a.bucket = 'reward_wallet'`)
  ).rows as { b: string }[];
  return BigInt(row?.b ?? '0');
}
async function rewardsFor(referee: string) {
  return db
    .select()
    .from(s.referralRewards)
    .where(eq(s.referralRewards.refereeId, referee));
}
// A released cash back for a shopper from a business.
async function buy(shopper: Identity, run: { id: string; merchant: Identity }) {
  const code = await campaigns.activate(shopper.user, run.id);
  const confirmed = await campaigns.confirm(run.merchant.user, run.id, {
    id: randomUUID(),
    code: code.code,
    amountKobo: '500000',
  });
  await travel('25 hours');
  try {
    await campaigns.release(shopper.user, confirmed.id);
  } finally {
    await travel('0');
  }
}

const boss = await verified();
const viewer = await identity();
for (const person of [boss, viewer])
  await db.insert(s.taskReviewerGrants).values({
    reviewerId: person.account,
    grantedBy: person.account,
    reason: 'Referral test',
    expiresAt: new Date(Date.now() + 3600000),
  });
process.env.SETTINGS_ADMIN_ACCOUNT_IDS = boss.account;
after(() => delete process.env.SETTINGS_ADMIN_ACCOUNT_IDS);

test('only settings admins fund the pool, once per top-up, with a bank reference', async () => {
  const topup = {
    id: randomUUID(),
    amountKobo: '1000000',
    bankReference: 'GTB-2026-10-0001',
    reason: 'October referral budget',
  };
  assert.equal(
    await reason(admin.fundReferralPool(viewer.user, topup)),
    'settings_read_only',
  );
  assert.equal(
    await reason(
      admin.fundReferralPool(boss.user, { ...topup, bankReference: '' }),
    ),
    400,
  );
  await admin.fundReferralPool(boss.user, topup);
  await admin.fundReferralPool(boss.user, topup);
  const pool = await admin.referralPool(viewer.user);
  assert.equal(pool.balanceKobo, '1000000');
  assert.equal(pool.topups.length, 1);
  assert.equal(pool.canFund, false);
  // Pool money cannot be forged straight into the ledger.
  await assert.rejects(
    db.execute(sql`
      insert into funding_transfers (id, source_id, destination_id, amount_kobo, kind, reference, actor_id, reason)
      values (gen_random_uuid(), (select id from funding_accounts where bucket = 'clearing'),
        (select id from funding_accounts where bucket = 'referral_pool'), 500, 'referral_pool_funded',
        ${`referral-topup:${randomUUID()}`}, ${boss.account}, 'Forged')`),
  );
});

test('a friend reward is the smaller of the fixed amount and half the first real payout', async () => {
  const inviter = await verified();
  const friend = await verified();
  await invite(inviter, friend);
  // ₦100 cash back is below the ₦200 that qualifies: nothing yet.
  await buy(friend, await campaign(1, '10000'));
  assert.equal((await rewardsFor(friend.account)).length, 0);
  // ₦300 cash back: half is ₦150, under the ₦200 cap.
  await buy(friend, await campaign(1, '30000'));
  const [reward] = await rewardsFor(friend.account);
  assert.equal(reward!.amountKobo, 15000n);
  assert.equal(reward!.basisKobo, 30000n);
  assert.equal(await wallet(inviter.account), 15000n);
  // Once per friend.
  await buy(friend, await campaign(1, '90000'));
  assert.equal((await rewardsFor(friend.account)).length, 1);
  const mine = await referrals.mine(inviter.user);
  assert.equal(mine.invited, 1);
  assert.equal(mine.earnedKobo, '15000');
});

test("the inviter's own business or workplace never qualifies a friend", async () => {
  const inviter = await verified();
  const friend = await verified();
  await invite(inviter, friend);
  await business('Inviter Foods', inviter);
  await buy(friend, await campaign(1, '50000', inviter));
  assert.equal((await rewardsFor(friend.account)).length, 0);
});

test('without pool money nothing is paid; the next payout pays once it is funded', async () => {
  const pool = await admin.referralPool(boss.user);
  // Use up the pool: a rule change to a reward bigger than what is left.
  await install(
    settings((v) => {
      v.referrals.friend.rewardKobo = 1_000_000;
      v.referrals.friend.maxPercent = 100;
      v.referrals.monthlyKobo = 1_000_000;
    }),
  );
  const inviter = await verified();
  const friend = await verified();
  await invite(inviter, friend);
  const big = BigInt(pool.balanceKobo) + 1000n;
  await buy(friend, await campaign(1, big.toString()));
  assert.equal((await rewardsFor(friend.account)).length, 0);
  await admin.fundReferralPool(boss.user, {
    id: randomUUID(),
    amountKobo: '2000000',
    bankReference: 'GTB-2026-10-0002',
    reason: 'Top up',
  });
  await buy(friend, await campaign(1, '20000'));
  const [reward] = await rewardsFor(friend.account);
  // Measured on the friend's largest payout so far (100% here), within the
  // ₦10,000 cap.
  assert.equal(reward!.basisKobo, big);
  assert.equal(reward!.amountKobo, big);
  await install(settings());
});

test('a business reward needs funding, real customers and pays a share of what they got', async () => {
  const inviter = await verified();
  const owner = await verified();
  await invite(inviter, owner);
  await business('Invited Bakery', owner);
  // Five customers at ₦300 cash back = ₦1,500 paid out; needs ₦10,000.
  const small = await campaign(5, '30000', owner);
  const shoppers: Identity[] = [];
  for (let i = 0; i < 5; i++) shoppers.push(await verified());
  for (const shopper of shoppers) await buy(shopper, small);
  assert.equal(
    (
      await db
        .select()
        .from(s.referralRewards)
        .where(
          and(
            eq(s.referralRewards.refereeId, owner.account),
            eq(s.referralRewards.kind, 'business'),
          ),
        )
    ).length,
    0,
  );
  // It has funded ₦13,500 so far; ₦20,000 is needed.
  await fund(owner.account, 1_000_000n);
  // Five more customers at ₦2,000 each: ₦11,500 paid to 10 people.
  // The inviter buying there does not count as a customer.
  const big = await campaign(6, '200000', owner);
  await buy(inviter, big);
  for (let i = 0; i < 5; i++) await buy(await verified(), big);
  const [reward] = (await rewardsFor(owner.account)).filter(
    (r) => r.kind === 'business',
  );
  // 10% of ₦11,500 is ₦1,150, under the ₦2,000 cap.
  assert.equal(reward!.basisKobo, 1_150_000n);
  assert.equal(reward!.amountKobo, 115_000n);
});

test('monthly limits per inviter hold, and rewards cannot be forged', async () => {
  await install(settings((v) => (v.referrals.monthlyCount = 1)));
  const inviter = await verified();
  const first = await verified();
  const second = await verified();
  await invite(inviter, first);
  await invite(inviter, second);
  await buy(first, await campaign(1, '40000'));
  await buy(second, await campaign(1, '40000'));
  assert.equal((await rewardsFor(first.account)).length, 1);
  assert.equal((await rewardsFor(second.account)).length, 0);
  await install(settings());

  const third = await verified();
  await invite(inviter, third);
  // A reward row that does not match the rules is refused.
  await assert.rejects(
    db.insert(s.referralRewards).values({
      refereeId: third.account,
      referrerId: inviter.account,
      kind: 'friend',
      amountKobo: 50000n,
      basisKobo: 100000n,
    }),
  );
  await assert.rejects(
    db.execute(sql`update referral_rewards set amount_kobo = 1`),
  );
});

test('setting up an account records the inviter from the link or a typed username', async () => {
  const inviter = await verified();
  const [named] = await db
    .insert(s.usernames)
    .values({
      username: 'ada_invites',
      accountId: inviter.account,
      isCurrent: true,
    })
    .returning();
  assert.ok(named);
  const fresh = async (invitedBy?: string) => {
    const user = randomUUID();
    await db.insert(s.authUsers).values({
      id: user,
      email: `${user}@example.test`,
      name: 'New',
      emailVerified: true,
      ...(invitedBy ? { invitedBy } : {}),
    });
    return user;
  };
  // From the link saved at sign-up.
  const linked = await fresh('ada_invites');
  const one = await accounts.createForAuth(linked, {
    username: 'linked_friend',
    displayName: 'Linked',
  });
  const [r1] = await db
    .select()
    .from(s.referrals)
    .where(eq(s.referrals.refereeId, one.id));
  assert.equal(r1?.referrerId, inviter.account);
  // Typed in; a typo is reported on the field.
  const typed = await fresh();
  await assert.rejects(
    accounts.createForAuth(typed, {
      username: 'typed_friend',
      displayName: 'Typed',
      invitedBy: 'nobody_here',
    }),
    (error: { field?: string }) => error.field === 'invitedBy',
  );
  const two = await accounts.createForAuth(typed, {
    username: 'typed_friend',
    displayName: 'Typed',
    invitedBy: 'Ada_Invites',
  });
  const [r2] = await db
    .select()
    .from(s.referrals)
    .where(eq(s.referrals.refereeId, two.id));
  assert.equal(r2?.referrerId, inviter.account);
  // An inviter without a verified phone is quietly not recorded.
  const unverified = await identity();
  await db.insert(s.usernames).values({
    username: 'no_phone',
    accountId: unverified.account,
    isCurrent: true,
  });
  const three = await accounts.createForAuth(await fresh(), {
    username: 'third_friend',
    displayName: 'Third',
    invitedBy: 'no_phone',
  });
  const r3 = await db
    .select()
    .from(s.referrals)
    .where(eq(s.referrals.refereeId, three.id));
  assert.equal(r3.length, 0);
});
