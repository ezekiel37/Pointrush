import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, test } from 'node:test';
import { eq, sql } from 'drizzle-orm';
import * as s from '../src/database/schema.js';
import { AdminService } from '../src/admin/admin.service.js';
import { ProfileEditsService } from '../src/profiles/profile-edits.service.js';
import { campaignFixture } from './helpers/campaign-fixture.js';
import type { Identity } from './helpers/campaign-fixture.js';

const { pg, db, identity, sponsors, campaign, travel } =
  await campaignFixture();
const edits = new ProfileEditsService(db);
const admin = new AdminService(db);
after(() => pg.close());

async function reason(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    const response = (error as { getResponse?: () => unknown }).getResponse?.();
    return (
      (response as { reason?: string })?.reason ??
      (error as { code?: string }).code ??
      (error as { status?: number }).status
    );
  }
  assert.fail('Expected rejection');
}
let names = 0;
async function person(): Promise<Identity & { username: string }> {
  const who = await identity();
  const username = `member_${++names}`;
  await db
    .insert(s.usernames)
    .values({ username, accountId: who.account, isCurrent: true });
  await db
    .insert(s.accountProfiles)
    .values({ accountId: who.account, displayName: `Member ${names}` });
  return { ...who, username };
}
async function reviewer() {
  const who = await person();
  await db.insert(s.taskReviewerGrants).values({
    reviewerId: who.account,
    grantedBy: who.account,
    reason: 'Profile test',
    expiresAt: new Date(Date.now() + 3600000),
  });
  return who;
}
async function open(owner: Identity, name: string, handle?: string) {
  return sponsors.createProfile(owner.user, {
    name,
    termsVersion: 'test',
    acceptTerms: true,
    ...(handle ? { handle } : {}),
  });
}

test('handles are unique across businesses and usernames, and some are reserved', async () => {
  const owner = await person();
  assert.deepEqual(await edits.checkHandle(owner.user, '@Mama_Put'), {
    available: true,
    reason: null,
    suggestion: null,
  });
  await open(owner, 'Mama Put Kitchen', 'mama_put');
  const taken = await edits.checkHandle(owner.user, 'mama_put');
  assert.equal(taken.reason, 'taken');
  assert.equal(taken.suggestion, 'mama_put_2');
  assert.equal(
    (await edits.checkHandle(owner.user, 'shoprite')).reason,
    'reserved',
  );
  assert.equal((await edits.checkHandle(owner.user, 'a')).reason, 'invalid');
  // A username is taken as a handle, and a handle as a username.
  assert.equal(
    (await edits.checkHandle(owner.user, owner.username)).reason,
    'taken',
  );
  await assert.rejects(
    db.insert(s.usernames).values({
      username: 'mama_put',
      accountId: (await identity()).account,
      isCurrent: true,
    }),
  );
  const other = await person();
  assert.equal(
    await reason(open(other, 'Copycat', 'mama_put')),
    'handle_unavailable',
  );
  // Left out, the handle comes from the name.
  await open(other, 'Mama Put Kitchen');
  assert.equal((await edits.mine(other.user)).handle, 'mama_put_kitchen');
});

test('an owner can change the handle once, before the first approved campaign', async () => {
  const owner = await person();
  await open(owner, 'Iya Basira', 'iya_basira');
  assert.equal((await edits.mine(owner.user)).canChangeHandle, true);
  await edits.changeHandle(owner.user, { handle: 'iya_basira_ikeja' });
  const mine = await edits.mine(owner.user);
  assert.equal(mine.handle, 'iya_basira_ikeja');
  assert.equal(mine.canChangeHandle, false);
  assert.equal(
    await reason(edits.changeHandle(owner.user, { handle: 'iya_basira_yaba' })),
    'handle_locked',
  );
  // The old handle stays reserved and leads to the new one.
  assert.deepEqual(await edits.publicBusiness('iya_basira'), {
    redirect: 'iya_basira_ikeja',
  });
  assert.equal(
    (await edits.checkHandle(owner.user, 'iya_basira')).reason,
    'taken',
  );
});

test('after a campaign is approved, only another reviewer can change the handle, with a reason', async () => {
  const owner = await person();
  const profile = await open(owner, 'Bukka Hut', 'bukka_hut');
  await campaign(1, '50000', owner);
  assert.equal((await edits.mine(owner.user)).canChangeHandle, false);
  assert.equal(
    await reason(edits.changeHandle(owner.user, { handle: 'bukka_hut_2' })),
    'handle_locked',
  );
  const staff = await reviewer();
  assert.equal(
    await reason(
      admin.setBusinessHandle(staff.user, profile.id, {
        handle: 'bukka_hut_vi',
      }),
    ),
    400,
  );
  await admin.setBusinessHandle(staff.user, profile.id, {
    handle: 'bukka_hut_vi',
    reason: 'Trademark complaint from Bukka Hut Ltd',
  });
  assert.equal((await edits.mine(owner.user)).handle, 'bukka_hut_vi');
});

test('a rename after approval waits for a reviewer, and the old name stays visible', async () => {
  const owner = await person();
  await open(owner, 'Chop Life', 'chop_life');
  // Before any approval, edits apply at once.
  assert.equal(
    (
      await edits.change(owner.user, {
        id: randomUUID(),
        field: 'name',
        value: 'Chop Life Kitchen',
      })
    ).state,
    'applied',
  );
  await edits.change(owner.user, {
    id: randomUUID(),
    field: 'description',
    value: 'Rice, swallow and grills in Yaba.',
  });
  await campaign(1, '50000', owner);
  const rename = {
    id: randomUUID(),
    field: 'name' as const,
    value: 'Shoprite Express',
  };
  assert.equal((await edits.change(owner.user, rename)).state, 'pending');
  // Repeating the request is safe; a second rename waits its turn.
  assert.equal((await edits.change(owner.user, rename)).state, 'pending');
  assert.equal(
    await reason(
      edits.change(owner.user, {
        id: randomUUID(),
        field: 'name',
        value: 'Another Name',
      }),
    ),
    'profile_change_pending',
  );
  // Contact details still change at once.
  assert.equal(
    (
      await edits.change(owner.user, {
        id: randomUUID(),
        field: 'contact_email',
        value: 'hello@choplife.ng',
      })
    ).state,
    'applied',
  );
  const staff = await reviewer();
  const { items } = await admin.profileChanges(staff.user);
  const waiting = items.find((c) => c.id === rename.id)!;
  assert.equal(waiting.oldValue, 'Chop Life Kitchen');
  // The owner cannot approve their own rename.
  assert.equal(
    await reason(
      admin.decideProfileChange(owner.user, rename.id, {
        decision: 'applied',
        reason: 'Mine',
      }),
    ),
    403,
  );
  await admin.decideProfileChange(staff.user, rename.id, {
    decision: 'rejected',
    reason: 'Impersonates a national brand',
  });
  let mine = await edits.mine(owner.user);
  assert.equal(mine.name, 'Chop Life Kitchen');
  assert.equal(mine.changes.find((c) => c.id === rename.id)?.state, 'rejected');
  const honest = {
    id: randomUUID(),
    field: 'name' as const,
    value: 'Chop Life Yaba',
  };
  await edits.change(owner.user, honest);
  await admin.decideProfileChange(staff.user, honest.id, {
    decision: 'applied',
    reason: 'Same business, new branch name',
  });
  mine = await edits.mine(owner.user);
  assert.equal(mine.name, 'Chop Life Yaba');
  const page = await edits.publicBusiness('chop_life');
  assert.ok(!('redirect' in page));
  if (!('redirect' in page)) {
    assert.deepEqual(
      page.formerly.map((f) => f.name),
      ['Chop Life Kitchen', 'Chop Life'],
    );
    assert.equal(page.description, 'Rice, swallow and grills in Yaba.');
    assert.equal(page.offers.length, 1);
  }
  // Nobody can edit the profile row directly.
  await assert.rejects(
    db.execute(
      sql`update sponsor_profiles set name = 'Hijacked' where owner_id = ${owner.account}`,
    ),
  );
  await assert.rejects(
    db.execute(sql`update business_profile_changes set new_value = 'X'`),
  );
});

test('display names change once a week; usernames keep their history', async () => {
  const who = await person();
  await edits.changeDisplayName(who.user, { displayName: 'Ada K' });
  assert.equal(
    await reason(edits.changeDisplayName(who.user, { displayName: 'Ada Kay' })),
    'display_name_too_soon',
  );
  await travel('8 days');
  try {
    await edits.changeDisplayName(who.user, { displayName: 'Ada Kay' });
  } finally {
    await travel('0');
  }
  const [profile] = await db
    .select()
    .from(s.accountProfiles)
    .where(eq(s.accountProfiles.accountId, who.account));
  assert.equal(profile!.displayName, 'Ada Kay');
  await assert.rejects(
    db.execute(
      sql`update account_profiles set display_name = 'Sneaky' where account_id = ${who.account}`,
    ),
  );

  const old = who.username;
  await edits.changeUsername(who.user, { username: 'ada_kay' });
  // The old username stays theirs and still finds them.
  const staff = await reviewer();
  const found = await admin.search(staff.user, old);
  assert.equal(found.items[0]?.id, who.account);
  const detail = await admin.accountDetail(staff.user, who.account);
  assert.deepEqual(detail.formerUsernames, [old]);
  assert.equal(
    await reason(edits.changeUsername(who.user, { username: 'ada_k2' })),
    'USERNAME_CHANGE_TOO_SOON',
  );
});

test('admin search finds a business by an old name or an old handle', async () => {
  const owner = await person();
  await open(owner, 'Mr Biggs Surulere', 'mrbiggs_sur');
  await edits.changeHandle(owner.user, { handle: 'big_bites_sur' });
  await edits.change(owner.user, {
    id: randomUUID(),
    field: 'name',
    value: 'Big Bites Surulere',
  });
  const staff = await reviewer();
  for (const term of ['mrbiggs', 'mr biggs', 'big_bites']) {
    const { items } = await admin.search(staff.user, term);
    assert.equal(items[0]?.id, owner.account, term);
    assert.equal(items[0]?.handle, 'big_bites_sur');
  }
  const detail = await admin.accountDetail(staff.user, owner.account);
  assert.deepEqual(detail.businessProfile?.handles, [
    'big_bites_sur',
    'mrbiggs_sur',
  ]);
  assert.deepEqual(detail.businessProfile?.formerNames, ['Mr Biggs Surulere']);
});
