import assert from 'node:assert/strict';
import { after, afterEach, test } from 'node:test';
import { sql } from 'drizzle-orm';
import { PhoneService } from '../src/phone/phone.service.js';
import { normalizePhone, TestSmsProvider } from '../src/phone/sms.js';
import { campaignFixture } from './helpers/campaign-fixture.js';

const { pg, db, identity, travel } = await campaignFixture();
after(() => pg.close());
afterEach(() => travel('0'));
const config = { allowedPrefixes: ['+234'], dailyLimit: 500 };

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
const lastCode = (sms: TestSmsProvider) =>
  /(\d{6})/.exec(sms.sent.at(-1)!.body)![1]!;
let numbers = 0;
const nextNumber = () => `0803${String(++numbers).padStart(7, '0')}`;

test('numbers normalise to E.164 and only mobile Nigerian numbers pass', () => {
  assert.equal(normalizePhone('0803 123 4567', '+234'), '+2348031234567');
  assert.equal(normalizePhone('+234 803-123-4567', '+234'), '+2348031234567');
  assert.equal(normalizePhone('002348031234567', '+234'), '+2348031234567');
  assert.equal(normalizePhone('+2341234567', '+234'), null);
  assert.equal(normalizePhone('hello', '+234'), null);
  assert.equal(normalizePhone('+447700900123', '+234'), '+447700900123');
});

test('verification is unavailable without an SMS provider', async () => {
  const person = await identity();
  assert.equal(
    await reason(
      new PhoneService(db).requestCode(person.user, {
        phoneNumber: nextNumber(),
      }),
    ),
    'phone_unavailable',
  );
});

test('a correct code verifies the number once and only for its owner', async () => {
  const sms = new TestSmsProvider();
  const phone = new PhoneService(db, sms, config);
  const person = await identity();
  assert.equal(
    await reason(phone.requestCode(person.user, { phoneNumber: 'abc' })),
    400,
  );
  assert.equal(
    await reason(
      phone.requestCode(person.user, { phoneNumber: '+447700900123' }),
    ),
    'country_unsupported',
  );
  assert.equal(sms.sent.length, 0);
  const number = nextNumber();
  const challenge = await phone.requestCode(person.user, {
    phoneNumber: number,
  });
  assert.equal(sms.sent.at(-1)!.to, `+234${number.slice(1)}`);
  assert.match(challenge.phone, /^\+234 ••• \d{4}$/);
  // The code is never stored in plain text.
  const stored = await db.execute(
    sql`select code_hash from phone_challenges where id = ${challenge.challengeId}`,
  );
  assert.ok(!JSON.stringify(stored).includes(lastCode(sms)));

  const other = await identity();
  assert.equal(
    await reason(
      phone.verify(other.user, {
        challengeId: challenge.challengeId,
        code: lastCode(sms),
      }),
    ),
    404,
  );
  assert.deepEqual(
    await phone.verify(person.user, {
      challengeId: challenge.challengeId,
      code: lastCode(sms),
    }),
    { verified: true, phone: challenge.phone },
  );
  assert.deepEqual(await phone.status(person.user), {
    verified: true,
    phone: challenge.phone,
  });
  // Used codes, verified accounts and taken numbers cannot start again.
  assert.equal(
    await reason(
      phone.verify(person.user, {
        challengeId: challenge.challengeId,
        code: lastCode(sms),
      }),
    ),
    'code_expired',
  );
  assert.equal(
    await reason(phone.requestCode(person.user, { phoneNumber: nextNumber() })),
    'phone_unavailable',
  );
  assert.equal(
    await reason(phone.requestCode(other.user, { phoneNumber: number })),
    'phone_unavailable',
  );
  await assert.rejects(
    db.execute(
      sql`delete from phone_challenges where id = ${challenge.challengeId}`,
    ),
  );
  await assert.rejects(
    db.execute(sql`update phone_challenge_attempts set success = true`),
  );
});

test('wrong guesses are limited, and expired or replaced codes stop working', async () => {
  const sms = new TestSmsProvider();
  const phone = new PhoneService(db, sms, config);
  const person = await identity();
  const first = await phone.requestCode(person.user, {
    phoneNumber: nextNumber(),
  });
  const code = lastCode(sms);
  const wrong = code === '000000' ? '111111' : '000000';
  for (let i = 0; i < 4; i++)
    assert.equal(
      await reason(
        phone.verify(person.user, {
          challengeId: first.challengeId,
          code: wrong,
        }),
      ),
      'code_wrong',
    );
  assert.equal(
    await reason(
      phone.verify(person.user, {
        challengeId: first.challengeId,
        code: wrong,
      }),
    ),
    'code_expired',
  );
  // Guesses are used up: even the right code no longer works.
  assert.equal(
    await reason(
      phone.verify(person.user, { challengeId: first.challengeId, code }),
    ),
    'code_expired',
  );
  assert.equal(
    await reason(phone.requestCode(person.user, { phoneNumber: nextNumber() })),
    'code_cooldown',
  );

  await travel('2 minutes');
  const second = await phone.requestCode(person.user, {
    phoneNumber: nextNumber(),
  });
  const secondCode = lastCode(sms);
  await travel('4 minutes');
  await phone.requestCode(person.user, { phoneNumber: nextNumber() });
  // A newer code replaces the older one.
  assert.equal(
    await reason(
      phone.verify(person.user, {
        challengeId: second.challengeId,
        code: secondCode,
      }),
    ),
    'code_expired',
  );
  await travel('16 minutes');
  const latest = lastCode(sms);
  const [row] = (
    await db.execute(
      sql`select id from phone_challenges where account_id = ${person.account} order by created_at desc limit 1`,
    )
  ).rows as { id: string }[];
  assert.equal(
    await reason(
      phone.verify(person.user, { challengeId: row!.id, code: latest }),
    ),
    'code_expired',
  );
});

test('sends are capped per account, per number and across the platform', async () => {
  const sms = new TestSmsProvider();
  const phone = new PhoneService(db, sms, config);
  const person = await identity();
  for (let i = 0; i < 5; i++) {
    await travel(`${2 * i} minutes`);
    await phone.requestCode(person.user, { phoneNumber: nextNumber() });
  }
  await travel('20 minutes');
  assert.equal(
    await reason(phone.requestCode(person.user, { phoneNumber: nextNumber() })),
    'code_limit',
  );

  const shared = nextNumber();
  for (let i = 0; i < 5; i++)
    await phone.requestCode((await identity()).user, { phoneNumber: shared });
  assert.equal(
    await reason(
      phone.requestCode((await identity()).user, { phoneNumber: shared }),
    ),
    'code_limit',
  );

  const busy = new PhoneService(db, sms, { ...config, dailyLimit: 1 });
  assert.equal(
    await reason(
      busy.requestCode((await identity()).user, { phoneNumber: nextNumber() }),
    ),
    'sms_busy',
  );

  // A failed send still counts, so failures cannot bypass the limits.
  sms.fail = true;
  const unlucky = await identity();
  assert.equal(
    await reason(
      phone.requestCode(unlucky.user, { phoneNumber: nextNumber() }),
    ),
    'sms_failed',
  );
  sms.fail = false;
  assert.equal(
    await reason(
      phone.requestCode(unlucky.user, { phoneNumber: nextNumber() }),
    ),
    'code_cooldown',
  );
});
