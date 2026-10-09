import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, test } from 'node:test';
import { eq, sql } from 'drizzle-orm';
import * as s from '../src/database/schema.js';
import { CampaignsService } from '../src/campaigns/campaigns.service.js';
import { BusinessOverviewService } from '../src/campaigns/business-overview.service.js';
import { TaskQueriesService } from '../src/tasks/task-queries.service.js';
import { AdminService } from '../src/admin/admin.service.js';
import { NotificationsService } from '../src/notifications/notifications.service.js';
import { campaignFixture, campaignTerms } from './helpers/campaign-fixture.js';
import {
  fundingBalance,
  postFundingTransfer,
} from '../src/funding/funding-ledger.js';

const fixture = await campaignFixture();
const { pg, db, sponsors, identity, travel, campaign } = fixture;
const terms = campaignTerms;
const campaigns = new CampaignsService(db);
after(() => pg.close());

const confirmation = (code: string, amountKobo = '450000') => ({
  id: randomUUID(),
  code,
  amountKobo,
});
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
    .where(eq(s.fundingAccounts.ownerId, account));
  return row?.bucket === 'reward_wallet' ? fundingBalance(db, row.id) : 0n;
}

test('campaign creation requires campaign terms and never mixes in work terms', async () => {
  const merchant = await identity();
  await sponsors.createProfile(merchant.user, {
    name: 'Kiosk',
    termsVersion: 'test',
    acceptTerms: true,
  });
  const base = {
    requestId: randomUUID(),
    title: 'Cash back',
    instructions: 'Buy',
    proofRequirements: 'Till confirmation',
    rejectionCriteria: 'Refunds',
    model: 'purchase_cashback',
    capacity: 1,
    rewardKobo: '100',
    startsAt: new Date(Date.now() + 60000).toISOString(),
    endsAt: new Date(Date.now() + 120000).toISOString(),
  };
  await assert.rejects(sponsors.createTask(merchant.user, base), {
    status: 400,
  });
  await assert.rejects(
    sponsors.createTask(merchant.user, {
      ...base,
      campaignTerms: { ...terms, holdHours: 2 },
    }),
    { status: 400 },
  );
  await assert.rejects(
    sponsors.createTask(merchant.user, {
      ...base,
      campaignTerms: terms,
      workTerms: {
        reviewHours: 1,
        correctionHours: 1,
        appealHours: 1,
        settlement: 'approved_reward_backing',
      },
    }),
    { status: 400 },
  );
});

test('code -> till confirmation -> hold -> release credits cash back exactly once', async () => {
  const { merchant, id, allocation } = await campaign();
  const shopper = await identity();
  const stranger = await identity();

  const code = await campaigns.activate(shopper.user, id);
  assert.match(code.display, /^[A-HJKMNP-Z2-9]{5}-[A-HJKMNP-Z2-9]{5}$/);
  assert.equal((await campaigns.activate(shopper.user, id)).code, code.code);
  assert.equal(
    await reason(campaigns.activate(merchant.user, id)),
    'offer_unavailable',
  );

  // Only the owning business can confirm, and only at or above the minimum spend.
  await assert.rejects(
    campaigns.confirm(stranger.user, id, confirmation(code.code)),
    { status: 404 },
  );
  assert.equal(
    await reason(
      campaigns.confirm(merchant.user, id, confirmation(code.code, '299999')),
    ),
    'confirmation_rejected',
  );
  assert.equal(
    await reason(
      campaigns.confirm(merchant.user, id, confirmation('ABCDE-FGHJK')),
    ),
    'confirmation_rejected',
  );
  const input = confirmation(code.display.toLowerCase());
  const confirmed = await campaigns.confirm(merchant.user, id, input);
  assert.equal(confirmed.cashbackKobo, '50000');
  assert.equal(
    (await campaigns.confirm(merchant.user, id, input)).id,
    confirmed.id,
  );
  // A photographed code cannot be used again, and one purchase per shopper per campaign.
  assert.equal(
    await reason(campaigns.confirm(merchant.user, id, confirmation(code.code))),
    'already_rewarded',
  );
  assert.equal(
    await reason(campaigns.activate(shopper.user, id)),
    'offer_unavailable',
  );

  assert.equal(
    await reason(campaigns.release(shopper.user, confirmed.id)),
    'not_releasable',
  );
  await assert.rejects(campaigns.release(stranger.user, confirmed.id), {
    status: 404,
  });
  const before = await campaigns.purchases(shopper.user);
  assert.equal(before.items[0]?.state, 'pending');

  await travel('25 hours');
  try {
    assert.equal(
      (await campaigns.purchases(shopper.user)).items[0]?.state,
      'releasable',
    );
    // Too late for the business to void once the hold has passed.
    assert.equal(
      await reason(
        campaigns.voidPurchase(merchant.user, confirmed.id, {
          reason: 'Refund',
        }),
      ),
      'void_rejected',
    );
    await campaigns.release(shopper.user, confirmed.id);
    await campaigns.release(shopper.user, confirmed.id);
  } finally {
    await travel('0');
  }
  assert.equal(await wallet(shopper.account), 50000n);
  assert.equal(await fundingBalance(db, allocation), 50000n);
  assert.equal(
    (await campaigns.purchases(shopper.user)).items[0]?.state,
    'released',
  );

  const summary = await campaigns.summary(merchant.user, id);
  assert.equal(summary.confirmed, 1);
  assert.equal(summary.released, 1);
  assert.equal(summary.remaining, 1);
  await assert.rejects(campaigns.summary(shopper.user, id), { status: 404 });
});

test('capacity is enforced, a void keeps its place while it can be disputed, and voided purchases never pay', async () => {
  const { merchant, id } = await campaign(2);
  const [a, b, c] = [await identity(), await identity(), await identity()];
  const ca = await campaigns.activate(a.user, id);
  const cb = await campaigns.activate(b.user, id);
  const cc = await campaigns.activate(c.user, id);
  const first = await campaigns.confirm(
    merchant.user,
    id,
    confirmation(ca.code),
  );
  await campaigns.confirm(merchant.user, id, confirmation(cb.code));
  assert.equal(
    await reason(campaigns.confirm(merchant.user, id, confirmation(cc.code))),
    'campaign_full',
  );
  await assert.rejects(
    campaigns.voidPurchase(merchant.user, first.id, { reason: ' ' }),
    { status: 400 },
  );
  const voided = await campaigns.voidPurchase(merchant.user, first.id, {
    reason: 'Order refunded at the counter',
  });
  assert.equal(
    (
      await campaigns.voidPurchase(merchant.user, first.id, {
        reason: 'Order refunded at the counter',
      })
    ).createdAt.getTime(),
    voided.createdAt.getTime(),
  );
  await assert.rejects(
    campaigns.voidPurchase(a.user, first.id, { reason: 'Mine' }),
    { status: 404 },
  );
  // For 7 days the shopper may dispute, so the place and money stay held.
  assert.equal(
    await reason(campaigns.confirm(merchant.user, id, confirmation(cc.code))),
    'campaign_full',
  );
  await travel('25 hours');
  try {
    assert.equal(
      await reason(campaigns.release(a.user, first.id)),
      'not_releasable',
    );
  } finally {
    await travel('0');
  }
  assert.equal(await wallet(a.account), 0n);
  const summary = await campaigns.summary(merchant.user, id);
  assert.deepEqual(
    [summary.confirmed, summary.voided, summary.remaining],
    [2, 1, 0],
  );
  const listed = await new TaskQueriesService(db).discover(c.user, {});
  assert.equal(listed.items.find((item) => item.id === id)?.claimed, 2);
  const queries = new TaskQueriesService(db);
  const offers = await queries.discover(c.user, { kind: 'offers' });
  assert.ok(offers.items.every((item) => item.model === 'purchase_cashback'));
  assert.ok(offers.items.some((item) => item.id === id));
  const jobs = await queries.discover(c.user, { kind: 'jobs' });
  assert.ok(!jobs.items.some((item) => item.id === id));
  await assert.rejects(queries.discover(c.user, { kind: 'bets' }), {
    status: 400,
  });
});

test('expired codes, daily shopper limits and code minting are bounded', async () => {
  const shopper = await identity();
  const runs = [];
  for (let i = 0; i < 6; i++) runs.push(await campaign(1, '1000'));
  for (const run of runs.slice(0, 5)) {
    const code = await campaigns.activate(shopper.user, run.id);
    await campaigns.confirm(run.merchant.user, run.id, confirmation(code.code));
  }
  const sixth = runs[5]!;
  const code = await campaigns.activate(shopper.user, sixth.id);
  assert.equal(
    await reason(
      campaigns.confirm(sixth.merchant.user, sixth.id, confirmation(code.code)),
    ),
    'daily_limit',
  );

  const late = await identity();
  const lateCode = await campaigns.activate(late.user, sixth.id);
  await travel('16 minutes');
  try {
    assert.equal(
      await reason(
        campaigns.confirm(
          sixth.merchant.user,
          sixth.id,
          confirmation(lateCode.code),
        ),
      ),
      'confirmation_rejected',
    );
    // An expired code is replaced rather than reused.
    assert.notEqual(
      (await campaigns.activate(late.user, sixth.id)).code,
      lateCode.code,
    );
  } finally {
    await travel('0');
  }
  // Two codes already exist; the hourly limit allows ten per shopper per campaign.
  for (let i = 0; i < 8; i++)
    await db.insert(s.purchaseCodes).values({
      taskId: sixth.id,
      accountId: late.account,
      code: `ZZZZZZZZ${'23456789'[i % 8]}${'ABCDEFGHJ'[i]}`,
      expiresAt: new Date(),
    });
  await assert.rejects(
    db.insert(s.purchaseCodes).values({
      taskId: sixth.id,
      accountId: late.account,
      code: 'ZZZZZZZZZZ',
      expiresAt: new Date(),
    }),
    (error: Error) =>
      String((error.cause as Error)?.message).includes(
        'Too many purchase codes',
      ),
  );
});

test('direct writes cannot bypass release, rewrite history or pay a non-buyer', async () => {
  const { merchant, id, allocation } = await campaign(1);
  const shopper = await identity();
  const thief = await identity();
  const code = await campaigns.activate(shopper.user, id);
  const confirmed = await campaigns.confirm(
    merchant.user,
    id,
    confirmation(code.code),
  );
  await campaigns.release(thief.user, confirmed.id).catch(() => undefined);
  const thiefWallet = (
    await db
      .insert(s.fundingAccounts)
      .values({ ownerId: thief.account, bucket: 'reward_wallet' })
      .returning()
  )[0]!;
  await assert.rejects(
    postFundingTransfer(db, {
      id: randomUUID(),
      sourceId: allocation,
      destinationId: thiefWallet.id,
      amountKobo: 50000n,
      actorId: thief.account,
      kind: 'purchase_cashback',
      reference: `purchase:${confirmed.id}`,
      reason: 'Attempted theft',
    }),
  );
  await assert.rejects(
    db.execute(
      sql`update purchase_confirmations set amount_kobo = 1 where id = ${confirmed.id}`,
    ),
  );
  await assert.rejects(
    db.execute(sql`delete from purchase_codes where id is not null`),
  );
  // Release is refused before the hold even for a direct insert.
  await assert.rejects(
    db.insert(s.purchaseReleases).values({ confirmationId: confirmed.id }),
  );
  assert.equal(await fundingBalance(db, allocation), 50000n);
});

test('business overview counts only its own activity by Lagos day and state', async () => {
  const overviews = new BusinessOverviewService(db);
  const { merchant, id } = await campaign(3, '50000');
  const other = await campaign(1, '50000');
  const [a, b, c, d] = [
    await identity(),
    await identity(),
    await identity(),
    await identity(),
  ];
  const buy = async (person: { user: string }, task: string, owner: string) => {
    const code = await campaigns.activate(person.user, task);
    return campaigns.confirm(owner, task, confirmation(code.code));
  };
  const first = await buy(a, id, merchant.user);
  const second = await buy(b, id, merchant.user);
  await buy(c, id, merchant.user);
  await buy(d, other.id, other.merchant.user);
  await campaigns.voidPurchase(merchant.user, second.id, { reason: 'Refund' });
  await travel('25 hours');
  try {
    await campaigns.release(a.user, first.id);
  } finally {
    await travel('0');
  }
  const view = await overviews.overview(merchant.user, { days: '7' });
  assert.equal(view.series.length, 7);
  assert.equal(view.series.at(-1)?.purchases, 3);
  assert.deepEqual(
    [view.purchases.held, view.purchases.paid, view.purchases.voided],
    [1, 1, 1],
  );
  assert.equal(view.lockedKobo, '100000');
  assert.equal(view.paidOutKobo, '50000');
  assert.equal(view.availableKobo, '0');
  await fixture.fund(merchant.account, 25000n);
  assert.equal(
    (await overviews.overview(merchant.user, { days: '7' })).availableKobo,
    '25000',
  );
  assert.equal(view.campaigns.length, 1);
  // The voided purchase keeps its place while the shopper may dispute it.
  assert.equal(view.campaigns[0]?.used, 3);
  assert.equal(view.campaigns[0]?.reviewNote, null);
  const sent = await fixture.draft(merchant);
  await sent.decide('changes_required', 'Add the full street address.');
  const notes = (await overviews.overview(merchant.user, { days: '7' }))
    .campaigns;
  assert.equal(
    notes.find((c) => c.id === sent.id)?.reviewNote,
    'Add the full street address.',
  );
  assert.equal(view.live, 1);
  assert.equal(
    (await overviews.overview(merchant.user, { days: '30' })).series.length,
    30,
  );
  await assert.rejects(overviews.overview(merchant.user, { days: '9' }), {
    status: 400,
  });
  await assert.rejects(overviews.overview(a.user), { status: 404 });
});

test('a monthly offer pays each shopper once per Lagos month, and the overview counts loyalty', async () => {
  const overviews = new BusinessOverviewService(db);
  const { merchant, id } = await campaign(10, '20000', undefined, {
    terms: { repeat: 'monthly' },
    days: 120,
  });
  const [regular, once] = [await identity(), await identity()];
  const buy = async (person: { user: string }) => {
    const code = await campaigns.activate(person.user, id);
    return campaigns.confirm(merchant.user, id, confirmation(code.code));
  };
  // Noon (Lagos) on the 1st of a coming month.
  const monthsAhead = async (months: number) => {
    const [row] = (
      await pg.query<{ offset: string }>(
        `select ((date_trunc('month', pg_catalog.clock_timestamp() at time zone 'Africa/Lagos')
          + make_interval(months => $1::int) + interval '12 hours') at time zone 'Africa/Lagos'
          - pg_catalog.clock_timestamp())::text as offset`,
        [months],
      )
    ).rows;
    await travel(row!.offset);
  };
  try {
    await monthsAhead(1);
    await buy(regular);
    await buy(once);
    // Once a month: the same shopper cannot get a second code or reward now.
    assert.equal(
      await reason(campaigns.activate(regular.user, id)),
      'offer_unavailable',
    );
    await monthsAhead(2);
    await buy(regular);
    await monthsAhead(3);
    await buy(regular);
    const view = await overviews.overview(merchant.user, { days: '7' });
    assert.deepEqual(view.customers, {
      total: 2,
      thisMonth: 1,
      new: 0,
      returning: 1,
      regular: 1,
      longTerm: 0,
      slippingAway: 0,
    });
    assert.equal((await campaigns.summary(merchant.user, id)).confirmed, 4);
    // Forty days without a visit: the regular is now slipping away.
    const [shifted] = (
      await pg.query<{ o: string }>(
        `select (current_setting('test.offset')::interval + interval '40 days')::text as o`,
      )
    ).rows;
    await travel(shifted!.o);
    const later = await overviews.overview(merchant.user, { days: '7' });
    assert.equal(later.customers.slippingAway, 1);
    assert.equal(later.customers.thisMonth, 0);
  } finally {
    await travel('0');
  }
});

test('a group offer pays everyone the full cash back once the target is reached', async () => {
  const group = { target: 2, baseKobo: '10000' };
  const reached = await campaign(3, '50000', undefined, {
    terms: { group },
  });
  const [a, b] = [await identity(), await identity()];
  const buy = async (person: { user: string }, task: string, owner: string) => {
    const code = await campaigns.activate(person.user, task);
    return campaigns.confirm(owner, task, confirmation(code.code));
  };
  const first = await buy(a, reached.id, reached.merchant.user);
  await travel('25 hours');
  try {
    // The hold has passed, but the group is not decided yet.
    assert.equal(
      (await campaigns.purchases(a.user)).items[0]?.state,
      'pending',
    );
    assert.equal(
      await reason(campaigns.release(a.user, first.id)),
      'not_releasable',
    );
  } finally {
    await travel('0');
  }
  const second = await buy(b, reached.id, reached.merchant.user);
  assert.equal(
    (await campaigns.summary(reached.merchant.user, reached.id)).groupComplete,
    true,
  );
  await travel('25 hours');
  try {
    await campaigns.release(a.user, first.id);
    await campaigns.release(b.user, second.id);
  } finally {
    await travel('0');
  }
  assert.equal(await wallet(a.account), 50000n);
  assert.equal(await wallet(b.account), 50000n);

  // Not reached by the end: each buyer gets the base amount, and the rest
  // returns to the business.
  const missed = await campaign(3, '50000', undefined, { terms: { group } });
  const c = await identity();
  const lone = await buy(c, missed.id, missed.merchant.user);
  await travel('3 days');
  try {
    assert.equal(
      (await campaigns.purchases(c.user)).items[0]?.payoutKobo,
      '10000',
    );
    await campaigns.release(c.user, lone.id);
    const back = await campaigns.returnFunds(missed.merchant.user, missed.id, {
      id: randomUUID(),
    });
    assert.equal(back.amountKobo, '140000');
  } finally {
    await travel('0');
  }
  assert.equal(await wallet(c.account), 10000n);

  // The base must be positive and below the full cash back, never monthly.
  const merchant = await fixture.business();
  const base = {
    requestId: randomUUID(),
    title: 'Group cash back',
    instructions: 'Buy',
    proofRequirements: 'Till confirmation',
    rejectionCriteria: 'Refunds',
    model: 'purchase_cashback',
    capacity: 5,
    rewardKobo: '50000',
    startsAt: new Date(Date.now() + 60000).toISOString(),
    endsAt: new Date(Date.now() + 120000).toISOString(),
  };
  for (const bad of [
    { target: 2, baseKobo: '0' },
    { target: 2, baseKobo: '50000' },
    { target: 9, baseKobo: '10000' },
  ])
    await assert.rejects(
      fixture.sponsors.createTask(merchant.user, {
        ...base,
        requestId: randomUUID(),
        campaignTerms: { ...terms, group: bad },
      }),
    );
  await assert.rejects(
    fixture.sponsors.createTask(merchant.user, {
      ...base,
      campaignTerms: { ...terms, group, repeat: 'monthly' },
    }),
    { status: 400 },
  );
});

test('voids are capped at 20%, shoppers can dispute for 7 days, and voided money stays locked until decided', async () => {
  const { merchant, id, allocation } = await campaign(20, '50000');
  const shoppers: Awaited<ReturnType<typeof identity>>[] = [];
  const bought: Awaited<ReturnType<typeof campaigns.confirm>>[] = [];
  for (let i = 0; i < 5; i++) {
    const person = await identity();
    const code = await campaigns.activate(person.user, id);
    shoppers.push(person);
    bought.push(
      await campaigns.confirm(merchant.user, id, confirmation(code.code)),
    );
  }
  const [a, b, c, d] = shoppers as [
    (typeof shoppers)[0],
    (typeof shoppers)[0],
    (typeof shoppers)[0],
    (typeof shoppers)[0],
  ];
  // 5 purchases: at most 3 voids (20%, but never fewer than 3).
  for (const purchase of bought.slice(0, 3))
    await campaigns.voidPurchase(merchant.user, purchase.id, {
      reason: 'Refunded',
    });
  assert.equal(
    await reason(
      campaigns.voidPurchase(merchant.user, bought[3]!.id, {
        reason: 'Refunded',
      }),
    ),
    'void_limit',
  );
  assert.equal((await campaigns.summary(merchant.user, id)).voidsLeft, 0);

  // Only the shopper can dispute, with a note.
  assert.equal(
    await reason(
      campaigns.dispute(b.user, bought[0]!.id, { note: 'I paid for it' }),
    ),
    'NotFoundException',
  );
  await assert.rejects(
    campaigns.dispute(a.user, bought[0]!.id, { note: ' ' }),
    {
      status: 400,
    },
  );
  assert.equal(
    await reason(
      campaigns.dispute(d.user, bought[3]!.id, { note: 'Not voided' }),
    ),
    'dispute_unavailable',
  );
  await campaigns.dispute(a.user, bought[0]!.id, {
    note: 'I paid N4,500 for rice, receipt 0412.',
  });
  await campaigns.dispute(a.user, bought[0]!.id, { note: 'Again' });
  await campaigns.dispute(c.user, bought[2]!.id, { note: 'It was real' });
  assert.equal(
    (await campaigns.purchases(a.user)).items[0]?.disputeUntil,
    null,
  );
  assert.ok((await campaigns.purchases(b.user)).items[0]?.disputeUntil);

  // A reviewer decides; nobody else can.
  const admin = new AdminService(db);
  const reviewer = await identity();
  await db.insert(s.taskReviewerGrants).values({
    reviewerId: reviewer.account,
    grantedBy: reviewer.account,
    reason: 'Dispute test',
    expiresAt: new Date(Date.now() + 3600000),
  });
  assert.equal(
    await reason(
      admin.ruleOnVoid(merchant.user, bought[0]!.id, {
        decision: 'upheld',
        reason: 'Mine',
      }),
    ),
    'ForbiddenException',
  );
  const open = await admin.voidDisputes(reviewer.user);
  assert.deepEqual(
    open.items
      .filter((i) => [bought[0]!.id, bought[2]!.id].includes(i.id))
      .map((i) => [i.note, i.campaignVoided, i.campaignConfirmed]),
    [
      ['I paid N4,500 for rice, receipt 0412.', 3, 5],
      ['It was real', 3, 5],
    ],
  );
  assert.equal(
    await reason(
      admin.ruleOnVoid(reviewer.user, bought[1]!.id, {
        decision: 'reversed',
        reason: 'No dispute',
      }),
    ),
    'ruling_unavailable',
  );
  await admin.ruleOnVoid(reviewer.user, bought[0]!.id, {
    decision: 'reversed',
    reason: 'Receipt matches the till record.',
  });
  await admin.ruleOnVoid(reviewer.user, bought[2]!.id, {
    decision: 'upheld',
    reason: 'The business showed the refund slip.',
  });
  // Reversed: paid once, straight to the wallet; release cannot pay again.
  assert.equal(await wallet(a.account), 50000n);
  assert.equal((await campaigns.purchases(a.user)).items[0]?.state, 'released');
  await travel('25 hours');
  try {
    assert.equal(
      await reason(campaigns.release(a.user, bought[0]!.id)),
      'not_releasable',
    );
  } finally {
    await travel('0');
  }
  assert.equal(await wallet(a.account), 50000n);
  assert.equal(await wallet(c.account), 0n);
  const inbox = await new NotificationsService(db).list(a.user);
  assert.ok(
    inbox.items.some(
      (n) => n.title === '₦500 cash back paid after your dispute',
    ),
  );

  // After the campaign ends, money for undisputed voids stays locked for 7 days.
  const returns = async () => {
    const before = await fundingBalance(db, allocation);
    await campaigns
      .returnFunds(merchant.user, id, { id: randomUUID() })
      .catch(() => undefined);
    return before - (await fundingBalance(db, allocation));
  };
  await travel('3 days');
  try {
    // Budget N10,000 - N500 reversed = N9,500 left. Kept: 2 unreleased
    // purchases and 1 undisputed void inside its 7 days.
    assert.equal(await returns(), 800000n);
  } finally {
    await travel('0');
  }
  await travel('8 days');
  try {
    assert.equal(
      await reason(
        campaigns.dispute(b.user, bought[1]!.id, { note: 'Too late' }),
      ),
      'dispute_unavailable',
    );
    assert.equal(await returns(), 50000n);
  } finally {
    await travel('0');
  }
  await assert.rejects(db.execute(sql`delete from purchase_void_disputes`));
  await assert.rejects(db.execute(sql`delete from purchase_void_rulings`));
});
