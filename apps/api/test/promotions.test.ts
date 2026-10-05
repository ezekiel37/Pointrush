import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, test } from 'node:test';
import { eq, sql } from 'drizzle-orm';
import * as s from '../src/database/schema.js';
import {
  failedClaimLimit,
  PromotionsService,
} from '../src/promotions/promotions.service.js';
import { PointsService } from '../src/points/points.service.js';
import {
  fundingBalance,
  postFundingTransfer,
} from '../src/funding/funding-ledger.js';
import { campaignFixture } from './helpers/campaign-fixture.js';
import type { Identity } from './helpers/campaign-fixture.js';

const { pg, db, identity, business, sponsors, promotion } =
  await campaignFixture();
const promotions = new PromotionsService(db);
after(() => pg.close());

let phones = 0;
async function verified() {
  const person = await identity();
  phones += 1;
  await db.insert(s.verifiedPhones).values({
    accountId: person.account,
    phoneNumber: `+234900${String(phones).padStart(7, '0')}`,
  });
  return person;
}
async function wallet(person: Identity) {
  const [row] = await db
    .select()
    .from(s.fundingAccounts)
    .where(eq(s.fundingAccounts.ownerId, person.account));
  return row?.bucket === 'reward_wallet' ? fundingBalance(db, row.id) : 0n;
}
async function reason(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    const response = (error as { getResponse?: () => unknown }).getResponse?.();
    return (response as { reason?: string })?.reason ?? (error as Error).name;
  }
  assert.fail('Expected rejection');
}
const claim = (person: Identity, code: string) =>
  promotions.claim(person.user, { id: randomUUID(), code });
async function batch(
  run: Awaited<ReturnType<typeof promotion>>,
  size: number,
  activate = true,
) {
  const issued = await promotions.createBatch(run.merchant.user, run.id, {
    id: randomUUID(),
    label: `Lagos stores ${size}`,
    size,
  });
  if (activate)
    await promotions.activateBatch(run.merchant.user, issued.batchId);
  return issued;
}

test('only every-code-wins promotions are accepted: Acticlaim runs no games of chance', async () => {
  const owner = await business('Terms Check');
  const base = {
    requestId: randomUUID(),
    title: 'Scratch and win',
    instructions: 'Scratch',
    proofRequirements: 'Code',
    rejectionCriteria: 'Invalid codes',
    model: 'claim_code',
    capacity: 1,
    rewardKobo: '100',
    startsAt: new Date(Date.now() + 60000).toISOString(),
    endsAt: new Date(Date.now() + 120000).toISOString(),
  };
  const terms = {
    claimLimitPerPerson: 1,
    howToGetCodes: 'Buy a drink',
  };
  for (const promotionTerms of [
    { ...terms, mode: 'chance', permit: null },
    {
      ...terms,
      mode: 'chance',
      permit: { authority: 'LSLGA', number: '1' },
    },
    {
      ...terms,
      mode: 'every_code_wins',
      permit: { authority: 'LSLGA', number: '1' },
    },
    { ...terms, mode: 'every_code_wins', permit: null, claimLimitPerPerson: 0 },
  ])
    await assert.rejects(
      sponsors.createTask(owner.user, { ...base, promotionTerms }),
      { status: 400 },
    );
  await assert.rejects(sponsors.createTask(owner.user, base), { status: 400 });
});

test('issued codes are shown once, capped by funded prizes and claimed exactly once', async () => {
  const run = await promotion(3, '100000');
  const stranger = await identity();
  const issued = await batch(run, 2, false);
  assert.equal(issued.codes.length, 2);
  assert.match(issued.codes[0]!, /^AC(-[A-HJKMNP-Z2-9]{4}){4}$/);
  assert.notEqual(issued.codes[0], issued.codes[1]);
  // Plaintext codes are never stored.
  const stored = await db
    .select()
    .from(s.claimCodes)
    .where(eq(s.claimCodes.batchId, issued.batchId));
  assert.ok(
    stored.every(
      (c) => !issued.codes.some((code) => code.includes(c.codeHash)),
    ),
  );
  assert.equal(
    await reason(
      promotions.createBatch(run.merchant.user, run.id, {
        id: issued.batchId,
        label: 'Retry',
        size: 2,
      }),
    ),
    'batch_already_issued',
  );
  assert.equal(
    await reason(
      promotions.createBatch(run.merchant.user, run.id, {
        id: randomUUID(),
        label: 'Too many',
        size: 2,
      }),
    ),
    'codes_exceed_prizes',
  );
  await assert.rejects(
    promotions.createBatch(stranger.user, run.id, {
      id: randomUUID(),
      label: 'Not mine',
      size: 1,
    }),
    { status: 404 },
  );

  const winner = await verified();
  const [first, second] = issued.codes as [string, string];
  // Inactive batches cannot be claimed yet.
  assert.equal(await reason(claim(winner, first)), 'claim_rejected');
  await assert.rejects(
    promotions.activateBatch(stranger.user, issued.batchId),
    { status: 404 },
  );
  await promotions.activateBatch(run.merchant.user, issued.batchId);
  await promotions.activateBatch(run.merchant.user, issued.batchId);

  assert.equal(await reason(claim(stranger, first)), 'phone_required');
  const merchantPhone = run.merchant;
  await db.insert(s.verifiedPhones).values({
    accountId: merchantPhone.account,
    phoneNumber: '+2349111111111',
  });
  assert.equal(await reason(claim(merchantPhone, first)), 'claim_rejected');

  // Forgiving input: lowercase, spaces, with or without the AC prefix.
  const input = {
    id: randomUUID(),
    code: first.toLowerCase().replaceAll('-', ' ').replace(/^ac /, ''),
  };
  const won = await promotions.claim(winner.user, input);
  assert.equal(won.prizeKobo, '100000');
  assert.equal(won.businessName, 'Fizz Drinks');
  assert.equal((await promotions.claim(winner.user, input)).id, won.id);
  assert.equal(await wallet(winner), 100000n);
  // Used code, by anyone, and the per-person limit.
  const other = await verified();
  assert.equal(await reason(claim(other, first)), 'claim_rejected');
  assert.equal(await reason(claim(winner, second)), 'claim_limit');
  assert.equal(await wallet(winner), 100000n);
  await claim(other, second);
  assert.equal(await wallet(other), 100000n);
  assert.equal(await fundingBalance(db, run.allocation), 100000n);

  const summary = await promotions.summary(run.merchant.user, run.id);
  assert.deepEqual(
    [summary.claimed, summary.issued, summary.availableToIssue],
    [2, 2, 1],
  );
  assert.equal(summary.batches[0]?.state, 'active');
  assert.equal((await promotions.claims(winner.user)).items[0]?.id, won.id);
  await assert.rejects(promotions.summary(winner.user, run.id), {
    status: 404,
  });
});

test('revoking a leaked batch blocks its codes and frees its unclaimed prizes', async () => {
  const run = await promotion(2, '5000', { claimLimitPerPerson: 5 });
  const issued = await batch(run, 2);
  const person = await verified();
  await claim(person, issued.codes[0]!);
  await assert.rejects(
    promotions.revokeBatch(run.merchant.user, issued.batchId, { reason: ' ' }),
    { status: 400 },
  );
  await promotions.revokeBatch(run.merchant.user, issued.batchId, {
    reason: 'Box of papers stolen from the depot',
  });
  assert.equal(await reason(claim(person, issued.codes[1]!)), 'claim_rejected');
  assert.equal(
    await reason(promotions.activateBatch(run.merchant.user, issued.batchId)),
    'batch_unavailable',
  );
  // One prize was claimed; the stolen unclaimed one can be reissued.
  const replacement = await batch(run, 1);
  await claim(person, replacement.codes[0]!);
  assert.equal(await wallet(person), 10000n);
  assert.equal(await fundingBalance(db, run.allocation), 0n);
});

test('code guessing is locked out after repeated failures', async () => {
  const run = await promotion(1, '1000');
  const issued = await batch(run, 1);
  const guesser = await verified();
  for (let i = 0; i < failedClaimLimit; i++)
    assert.equal(
      await reason(claim(guesser, `AC-AAAA-BBBB-CCCC-${'23456789AB'[i]}DEF`)),
      'claim_rejected',
    );
  // Even the real code is refused once locked out.
  assert.equal(
    await reason(claim(guesser, issued.codes[0]!)),
    'claim_rate_limit',
  );
  await assert.rejects(claim(guesser, 'not a code'), { status: 400 });
});

test('direct writes cannot add codes later, forge prizes or earn points from luck', async () => {
  const run = await promotion(3, '50000', {
    mode: 'every_code_wins',
    permit: null,
  });
  const issued = await batch(run, 1);
  await assert.rejects(
    db.insert(s.claimCodes).values({
      batchId: issued.batchId,
      taskId: run.id,
      codeHash: 'a'.repeat(64),
    }),
  );
  // A batch without its codes cannot commit.
  await assert.rejects(
    db.transaction(async (tx) => {
      await tx.insert(s.claimCodeBatches).values({
        id: randomUUID(),
        taskId: run.id,
        actorId: run.merchant.account,
        size: 1,
        label: 'Empty',
      });
    }),
  );
  const thief = await verified();
  const thiefWallet = (
    await db
      .insert(s.fundingAccounts)
      .values({ ownerId: thief.account, bucket: 'reward_wallet' })
      .returning()
  )[0]!;
  await assert.rejects(
    postFundingTransfer(db, {
      id: randomUUID(),
      sourceId: run.allocation,
      destinationId: thiefWallet.id,
      amountKobo: 50000n,
      actorId: thief.account,
      kind: 'prize_claim',
      reference: `claim-code:${randomUUID()}`,
      reason: 'Forged prize',
    }),
  );
  const funder = await identity();
  await db
    .insert(s.pointsPools)
    .values({ points: 100000n, actorId: funder.account, reason: 'Pool' });
  const winner = await verified();
  const won = await claim(winner, issued.codes[0]!);
  await assert.rejects(
    db.execute(
      sql`update claim_redemptions set account_id = ${thief.account} where id = ${won.id}`,
    ),
  );
  const summary = await new PointsService(db).summary(winner.user);
  assert.equal(summary.points.pending, '0');
  assert.equal(summary.tier.businesses, 0);
});
