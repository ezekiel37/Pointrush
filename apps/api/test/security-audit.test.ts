import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, test } from 'node:test';
import { eq } from 'drizzle-orm';
import * as s from '../src/database/schema.js';
import { checkMoneyPassword } from '../src/audit/audit.js';
import { CampaignsService } from '../src/campaigns/campaigns.service.js';
import { StaffService } from '../src/sponsors/staff.service.js';
import { SessionManagementService } from '../src/auth/session-management.js';
import { AdminService } from '../src/admin/admin.service.js';
import { campaignFixture } from './helpers/campaign-fixture.js';

const fixture = await campaignFixture();
const { pg, db, identity, campaign } = fixture;
const campaigns = new CampaignsService(db);
after(() => pg.close());

async function reason(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    const response = (error as { getResponse?: () => unknown }).getResponse?.();
    return (response as { reason?: string })?.reason ?? (error as Error).name;
  }
  assert.fail('Expected rejection');
}

test('five wrong money passwords in 15 minutes pause withdrawals and bills', async () => {
  const person = await identity();
  for (let i = 0; i < 5; i++)
    assert.equal(
      await checkMoneyPassword(
        db,
        person.user,
        'withdrawal',
        async () => false,
      ),
      false,
    );
  // Even the right password is refused while paused.
  assert.equal(
    await reason(checkMoneyPassword(db, person.user, 'bill', async () => true)),
    'password_attempts',
  );
  const failures = await db
    .select()
    .from(s.auditEvents)
    .where(eq(s.auditEvents.subject, person.user));
  assert.equal(failures.length, 5);
  assert.equal(failures[0]?.kind, 'money_password_failed');
  // After 15 minutes the pause lifts.
  await fixture.travel('16 minutes');
  try {
    assert.equal(
      await checkMoneyPassword(db, person.user, 'bill', async () => true),
      true,
    );
  } finally {
    await fixture.travel('0');
  }
  // Audit events can never be edited or removed.
  await assert.rejects(db.delete(s.auditEvents));
  await assert.rejects(db.update(s.auditEvents).set({ kind: 'sign_in' }));
});

test('revoking sessions and reviewer look-ups are recorded', async () => {
  const person = await identity();
  await new SessionManagementService(db).revokeOthers(person.user, 'current');
  const [revoked] = await db
    .select()
    .from(s.auditEvents)
    .where(eq(s.auditEvents.subject, person.user));
  assert.equal(revoked?.kind, 'sessions_revoked');

  const reviewer = await identity();
  await db.insert(s.taskReviewerGrants).values({
    reviewerId: reviewer.account,
    grantedBy: fixture.reviewer,
    reason: 'Synthetic',
    expiresAt: new Date(Date.now() + 3600000),
  });
  const target = await identity();
  await db.insert(s.usernames).values({
    username: 'looked_at',
    accountId: target.account,
    isCurrent: true,
  });
  const admin = new AdminService(db);
  await admin.findAccount(reviewer.user, 'looked_at');
  await admin.voidDisputes(reviewer.user);
  const views = await db
    .select()
    .from(s.auditEvents)
    .where(eq(s.auditEvents.actor, reviewer.account));
  assert.deepEqual(views.map((v) => v.kind).sort(), [
    'admin_account_viewed',
    'admin_disputes_viewed',
  ]);
  assert.ok(views.some((v) => v.subject === target.account));
});

test('bring a friend: staff cannot invite, and nobody confirms their own invitee', async () => {
  const merchant = await fixture.business();
  const regular = await campaign(3, '50000', merchant);
  const [cashier, friend] = [await identity(), await identity()];
  await db.insert(s.usernames).values({
    username: 'till_cashier',
    accountId: cashier.account,
    isCurrent: true,
  });
  // The cashier bought here before joining the staff.
  const code = await campaigns.activate(cashier.user, regular.id);
  await campaigns.confirm(merchant.user, regular.id, {
    id: randomUUID(),
    code: code.code,
    amountKobo: '450000',
  });
  const staff = new StaffService(db);
  const added = await staff.add(merchant.user, {
    id: randomUUID(),
    username: 'till_cashier',
  });
  await staff.accept(cashier.user, added.items[0]!.id);
  const friends = await campaign(3, '100000', merchant, {
    terms: { referral: { referrerKobo: '40000' } },
  });
  assert.equal(
    await reason(
      campaigns.activate(friend.user, friends.id, { ref: 'till_cashier' }),
    ),
    'invite_unavailable',
  );
});
