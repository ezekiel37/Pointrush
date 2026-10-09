import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, test } from 'node:test';
import { sql } from 'drizzle-orm';
import * as s from '../src/database/schema.js';
import { AdminService } from '../src/admin/admin.service.js';
import { PaymentsService } from '../src/payments/payments.service.js';
import { TestPaymentProvider } from '../src/payments/provider.js';
import { defaultSettings } from '../src/settings/settings.js';
import { SettingsController } from '../src/settings/settings.controller.js';
import { lowLimits } from './helpers/settings.js';
import { campaignFixture, campaignTerms } from './helpers/campaign-fixture.js';

const { pg, db, identity, business, sponsors, campaign, travel } =
  await campaignFixture();
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
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
async function install(settings: unknown) {
  await db.execute(
    sql`insert into platform_settings (settings, reason)
      values (${JSON.stringify(settings)}::jsonb, 'Test')`,
  );
}

test('the migration installs the documented defaults', async () => {
  const [first] = (
    await db.execute(
      sql`select settings from platform_settings order by version limit 1`,
    )
  ).rows as { settings: unknown }[];
  assert.deepEqual(first!.settings, defaultSettings);
});

test('reviewers read settings; only named admins change them, with a reason, and history is kept', async () => {
  const ordinary = await identity();
  const reviewer = await appointed();
  const boss = await appointed();
  assert.equal(await reason(admin.settings(ordinary.user)), 403);
  const read = await admin.settings(reviewer.user);
  assert.equal(read.canEdit, false);
  const next = clone(defaultSettings);
  next.campaigns.minCashbackKobo = 20000;
  assert.equal(
    await reason(
      admin.updateSettings(reviewer.user, {
        settings: next,
        reason: 'Raise the floor',
      }),
    ),
    'settings_read_only',
  );

  process.env.SETTINGS_ADMIN_ACCOUNT_IDS = `${randomUUID()}, ${boss.account}`;
  try {
    assert.equal((await admin.settings(boss.user)).canEdit, true);
    // A reward above the monthly cap is refused with the field named.
    const bad = clone(defaultSettings);
    bad.referrals.friend.rewardKobo = bad.referrals.monthlyKobo + 1;
    try {
      await admin.updateSettings(boss.user, { settings: bad, reason: 'Oops' });
      assert.fail('Expected rejection');
    } catch (error) {
      const body = (
        error as { getResponse: () => { issues: { path: string }[] } }
      ).getResponse();
      assert.deepEqual(
        body.issues.map((i) => i.path),
        ['referrals.friend.rewardKobo'],
      );
    }
    // Ceilings stop an extra zero becoming a loss.
    const huge = clone(defaultSettings);
    huge.referrals.business.rewardKobo = 100_000_000;
    assert.equal(
      await reason(
        admin.updateSettings(boss.user, { settings: huge, reason: 'Typo' }),
      ),
      'invalid_settings',
    );
    assert.equal(
      await reason(admin.updateSettings(boss.user, { settings: next })),
      400,
    );
    const saved = await admin.updateSettings(boss.user, {
      settings: next,
      reason: 'Raise the floor',
    });
    assert.equal(saved.current.campaigns.minCashbackKobo, 20000);
    const after = await admin.settings(reviewer.user);
    assert.equal(after.current.campaigns.minCashbackKobo, 20000);
    assert.equal(after.history[0]!.reason, 'Raise the floor');
    const [audit] = await db
      .select()
      .from(s.auditEvents)
      .where(sql`${s.auditEvents.kind} = 'admin_settings_changed'`);
    assert.equal(audit!.actor, boss.account);
    // History cannot be edited or deleted.
    await assert.rejects(db.execute(sql`delete from platform_settings`));
    await assert.rejects(
      db.execute(sql`update platform_settings set reason = 'Edited'`),
    );
  } finally {
    delete process.env.SETTINGS_ADMIN_ACCOUNT_IDS;
  }
  await lowLimits(db);
});

test('minimums from settings stop tiny cash back, budgets and top-ups', async () => {
  const strict = clone(defaultSettings);
  await install(strict);
  const merchant = await business('Tiny Treats');
  const task = (rewardKobo: string, capacity: number) =>
    sponsors.createTask(merchant.user, {
      requestId: randomUUID(),
      title: 'Lunch cash back',
      instructions: 'Buy any meal and show your Acticlaim code at the counter.',
      proofRequirements: 'Purchase confirmed by the business in the shop.',
      rejectionCriteria: 'Refunded or cancelled orders.',
      model: 'purchase_cashback',
      capacity,
      rewardKobo,
      startsAt: new Date(Date.now() + 1000).toISOString(),
      endsAt: new Date(Date.now() + 86400000).toISOString(),
      campaignTerms,
    });
  // ₦50 cash back is below the ₦100 floor.
  assert.equal(await reason(task('5000', 200)), 'below_minimum');
  // ₦100 × 10 = ₦1,000 is below the ₦5,000 campaign floor.
  assert.equal(await reason(task('10000', 10)), 'below_minimum');
  const payments = new PaymentsService(
    db,
    new TestPaymentProvider('test-webhook-secret-0123456789abcdef'),
  );
  assert.equal(
    await reason(
      payments.createFundingIntent(merchant.user, {
        id: randomUUID(),
        amountKobo: '99999',
      }),
    ),
    'below_minimum',
  );
  const limits = await new SettingsController({ db } as never).limits();
  assert.equal(limits.campaigns.minCashbackKobo, 10000);
  assert.equal(limits.referrals.friend?.rewardKobo, 20000);
  // Back to tiny limits for the rest of the file.
  await lowLimits(db);
});

test('analytics come from the ledger, and search finds people and businesses', async () => {
  const reviewer = await appointed();
  const ordinary = await identity();
  assert.equal(await reason(admin.analytics(ordinary.user)), 403);
  const before = await admin.analytics(reviewer.user);
  await campaign(2, '50000', await business('Bukka Express'));
  const after = await admin.analytics(reviewer.user);
  assert.equal(
    BigInt(after.money.fundedKobo) - BigInt(before.money.fundedKobo),
    100000n,
  );
  assert.equal(after.businesses.total, before.businesses.total + 1);
  assert.equal(after.series.length, 14);

  assert.equal(await reason(admin.search(reviewer.user, 'a')), 400);
  const found = await admin.search(reviewer.user, 'bukka');
  assert.equal(found.items[0]!.businessName, 'Bukka Express');
  const detail = await admin.accountDetail(reviewer.user, found.items[0]!.id);
  assert.equal(detail.businessProfile?.name, 'Bukka Express');
  assert.equal(detail.businessProfile?.fundedKobo, '100000');
  // By email, too.
  const byEmail = await admin.search(reviewer.user, found.items[0]!.email!);
  assert.equal(byEmail.items[0]!.id, found.items[0]!.id);
  // Wildcards are taken literally.
  assert.equal((await admin.search(reviewer.user, '%%')).items.length, 0);
});

test('a new business has lower limits for its first days', async () => {
  const limits = clone(defaultSettings);
  limits.campaigns.minCashbackKobo = 1;
  limits.campaigns.minBudgetKobo = 1;
  limits.funding.minKobo = 10000;
  limits.newBusinesses = {
    days: 14,
    maxFundingKobo: 1000000,
    maxBudgetKobo: 1000000,
  };
  await install(limits);
  try {
    const merchant = await business('Brand New Bakery');
    const task = (rewardKobo: string, capacity: number) =>
      sponsors.createTask(merchant.user, {
        requestId: randomUUID(),
        title: 'Lunch cash back',
        instructions:
          'Buy any meal and show your Acticlaim code at the counter.',
        proofRequirements: 'Purchase confirmed by the business in the shop.',
        rejectionCriteria: 'Refunded or cancelled orders.',
        model: 'purchase_cashback',
        capacity,
        rewardKobo,
        startsAt: new Date(Date.now() + 1000).toISOString(),
        endsAt: new Date(Date.now() + 86400000).toISOString(),
        campaignTerms,
      });
    // ₦500 × 30 = ₦15,000, over the ₦10,000 a new business may lock.
    assert.equal(await reason(task('50000', 30)), 'above_maximum');
    const payments = new PaymentsService(
      db,
      new TestPaymentProvider('test-webhook-secret-0123456789abcdef'),
    );
    assert.equal(
      await reason(
        payments.createFundingIntent(merchant.user, {
          id: randomUUID(),
          amountKobo: '1000001',
        }),
      ),
      'above_maximum',
    );
    // Two weeks on, the usual limits apply.
    await travel('15 days');
    await payments.createFundingIntent(merchant.user, {
      id: randomUUID(),
      amountKobo: '1000001',
    });
  } finally {
    await travel('0');
    await lowLimits(db);
  }
});
