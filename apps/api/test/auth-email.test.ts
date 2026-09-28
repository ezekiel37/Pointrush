import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { before, after, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { eq, ne, sql } from 'drizzle-orm';
import * as schema from '../src/database/schema.js';
import {
  createResendAuthEmail,
  createResendPayloadSender,
  EmailDeliveryError,
} from '../src/auth/auth.email.js';
import { AuthEmailBudget } from '../src/auth/auth.email-budget.js';
import { createQueuedAuthEmail } from '../src/auth/email-queue.js';
import type { SendAuthEmail } from '../src/auth/auth.email.js';
import { createAuth } from '../src/auth/auth.factory.js';

const pg = new PGlite();
const db = drizzle(pg, { schema });
const secret = randomBytes(32).toString('hex');
const message = {
  kind: 'verify-email' as const,
  to: 'member@example.test',
  url: 'https://api.example.test/verify?token=secret',
};

test('queued sends distinguish concurrent provider requests from payload conflicts', async () => {
  for (const name of [
    'concurrent_idempotent_requests',
    'invalid_idempotent_request',
  ]) {
    const send = createResendPayloadSender('re_test', async () =>
      Response.json({ name }, { status: 409 }),
    );
    await assert.rejects(
      send(
        {
          from: 'sender@example.test',
          to: 'user@example.test',
          subject: 'Test',
          text: 'Test',
        },
        'stable-key',
      ),
      (error: unknown) => {
        assert.ok(error instanceof EmailDeliveryError);
        assert.equal(
          error.retryable,
          name === 'concurrent_idempotent_requests',
        );
        return true;
      },
    );
  }
});
before(async () => {
  await migrate(db, { migrationsFolder: resolve('migrations') });
});
after(async () => {
  await pg.close();
});

test('ambiguous transport failures retry with identical payload and idempotency key', async () => {
  const calls: RequestInit[] = [];
  const send = createResendAuthEmail(
    're_test',
    'sender@example.test',
    async (url, init) => {
      assert.equal(url, 'https://api.resend.com/emails');
      assert.ok(init);
      assert.ok(init.signal instanceof AbortSignal);
      calls.push(init);
      if (calls.length === 1) throw new Error('raw sensitive provider error');
      return Response.json({ id: 'accepted' });
    },
  );
  await send(message);
  assert.equal(calls.length, 2);
  assert.equal(calls[0]!.body, calls[1]!.body);
  const firstKey = new Headers(calls[0]!.headers).get('Idempotency-Key');
  assert.ok(firstKey);
  assert.equal(firstKey, new Headers(calls[1]!.headers).get('Idempotency-Key'));
  assert.ok(!firstKey.includes(message.to));
  assert.ok(!firstKey.includes('secret'));
});

test('provider errors remain private, retries are bounded and explicit backoff is respected', async () => {
  for (const status of [401, 422, 429, 503]) {
    let calls = 0;
    const send = createResendAuthEmail(
      're_test',
      'sender@example.test',
      async () => {
        calls++;
        return new Response('secret-address-and-token', {
          status,
          headers: status === 503 ? { 'Retry-After': '60' } : {},
        });
      },
    );
    await assert.rejects(send(message), {
      message: 'Authentication email delivery failed',
    });
    assert.equal(calls, 1);
  }
  let attempts = 0;
  const send = createResendAuthEmail(
    're_test',
    'sender@example.test',
    async () => {
      attempts++;
      return new Response('', { status: 500 });
    },
  );
  await assert.rejects(send(message), {
    message: 'Authentication email delivery failed',
  });
  assert.equal(attempts, 2);
});

test('shared recipient cooldown, hourly cap and global budget use database time', async () => {
  const budget = new AuthEmailBudget(db, secret, 4);
  assert.equal(await budget.claim('Member@example.test'), true);
  assert.equal(await budget.claim(' member@EXAMPLE.test '), false);
  let [global] = await db
    .select()
    .from(schema.authEmailBudgets)
    .where(eq(schema.authEmailBudgets.key, 'global'));
  assert.equal(
    global?.attempts,
    1,
    'recipient rejection must roll back global increment',
  );
  for (let i = 0; i < 2; i++) {
    await db
      .update(schema.authEmailBudgets)
      .set({ lastAttemptAt: sql`clock_timestamp() - interval '61 seconds'` })
      .where(ne(schema.authEmailBudgets.key, 'global'));
    assert.equal(await budget.claim('member@example.test'), true);
  }
  await db
    .update(schema.authEmailBudgets)
    .set({ lastAttemptAt: sql`clock_timestamp() - interval '61 seconds'` })
    .where(ne(schema.authEmailBudgets.key, 'global'));
  assert.equal(
    await budget.claim('member@example.test'),
    false,
    'hourly cap survives cooldown',
  );
  assert.equal(await budget.claim('another@example.test'), true);
  assert.equal(
    await budget.claim('third@example.test'),
    false,
    'global limit applies across recipients',
  );
  [global] = await db
    .select()
    .from(schema.authEmailBudgets)
    .where(eq(schema.authEmailBudgets.key, 'global'));
  assert.equal(global?.attempts, 4);
  const rows = await db.select().from(schema.authEmailBudgets);
  assert.ok(rows.every((row) => !row.key.includes('@')));
  await db.update(schema.authEmailBudgets).set({
    windowStartedAt: sql`clock_timestamp() - interval '25 hours'`,
    lastAttemptAt: sql`clock_timestamp() - interval '25 hours'`,
  });
  assert.equal(await budget.claim('member@example.test'), true);
});

test('queued emails consume reservations and preserve reset response and cooldown parity', async () => {
  await db.delete(schema.authEmailBudgets);
  let sends = 0;
  const enqueue = createQueuedAuthEmail(
    randomBytes(32).toString('hex'),
    'sender@example.test',
  );
  const protectedSend: SendAuthEmail = async (message) => {
    await enqueue(message);
    sends++;
  };
  const auth = createAuth(
    db,
    {
      secret,
      baseURL: 'https://api.example.test',
      trustedOrigins: ['https://app.example.test'],
    },
    protectedSend,
    (recipient) => new AuthEmailBudget(db, secret, 100).claim(recipient),
  );
  let ip = 0;
  const post = (path: string, body: Record<string, string>) =>
    auth.handler(
      new Request(`https://api.example.test/api/v1/auth${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://app.example.test',
          'x-pointrush-client-ip': `192.0.2.${++ip}`,
        },
        body: JSON.stringify(body),
      }),
    );
  assert.equal(
    (
      await post('/sign-up/email', {
        email: 'outage@example.test',
        password: 'A long valid password 123!',
        name: 'Outage User',
      })
    ).status,
    200,
  );
  assert.equal(sends, 1);
  await db
    .update(schema.authEmailBudgets)
    .set({ lastAttemptAt: sql`clock_timestamp() - interval '61 seconds'` })
    .where(ne(schema.authEmailBudgets.key, 'global'));
  const known = await post('/request-password-reset', {
    email: 'outage@example.test',
  });
  const unknown = await post('/request-password-reset', {
    email: 'unknown@example.test',
  });
  assert.equal(known.status, 200);
  assert.equal(unknown.status, known.status);
  assert.deepEqual(await known.json(), await unknown.json());
  assert.equal(sends, 2);
  const knownLimited = await post('/send-verification-email', {
    email: 'outage@example.test',
  });
  const unknownLimited = await post('/send-verification-email', {
    email: 'unknown@example.test',
  });
  assert.equal(knownLimited.status, 429);
  assert.equal(unknownLimited.status, 429);
  assert.deepEqual(await knownLimited.json(), await unknownLimited.json());
  assert.equal(sends, 2);
  await db
    .update(schema.authEmailBudgets)
    .set({ lastAttemptAt: sql`clock_timestamp() - interval '61 seconds'` })
    .where(ne(schema.authEmailBudgets.key, 'global'));
  const failed = await post('/request-password-reset', {
    email: 'outage@example.test',
  });
  assert.equal(failed.status, 200);
  assert.equal(sends, 3);
  assert.equal((await db.select().from(schema.authSessions)).length, 0);
});

test('budget storage failure never calls the provider', async () => {
  await pg.exec(
    'ALTER TABLE auth_email_budgets RENAME TO unavailable_email_budgets',
  );
  let sends = 0;
  try {
    const auth = createAuth(
      db,
      { secret, baseURL: 'https://api.example.test', trustedOrigins: [] },
      async () => {
        sends++;
      },
      (recipient) => new AuthEmailBudget(db, secret, 100).claim(recipient),
    );
    const result = await auth.handler(
      new Request(
        'https://api.example.test/api/v1/auth/request-password-reset',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Origin: 'https://api.example.test',
          },
          body: JSON.stringify({ email: 'outage@example.test' }),
        },
      ),
    );
    assert.equal(result.status, 503);
    assert.equal(sends, 0);
  } finally {
    await pg.exec(
      'ALTER TABLE unavailable_email_budgets RENAME TO auth_email_budgets',
    );
  }
});
