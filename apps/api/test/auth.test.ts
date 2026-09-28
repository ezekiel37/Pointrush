import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { after, before, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { eq } from 'drizzle-orm';
import * as schema from '../src/database/schema.js';
import { createAuth } from '../src/auth/auth.factory.js';
import {
  authEmailContent,
  createResendAuthEmail,
} from '../src/auth/auth.email.js';
import type { AuthEmail } from '../src/auth/auth.email.js';

const pg = new PGlite();
const db = drizzle(pg, { schema });
const mailbox: AuthEmail[] = [];
const config = {
  secret: randomBytes(32).toString('hex'),
  baseURL: 'https://api.pointrush.test',
  trustedOrigins: ['https://pointrush.test'],
};
const auth = createAuth(db, config, async (message) => {
  mailbox.push(message);
});
const password = 'A long test passphrase 123!';
let address = 0;

function request(
  path: string,
  body?: Record<string, unknown>,
  cookie?: string,
  origin = 'https://pointrush.test',
) {
  return auth.handler(
    new Request(`${config.baseURL}/api/v1/auth${path}`, {
      method: body ? 'POST' : 'GET',
      headers: {
        'content-type': 'application/json',
        origin,
        'x-pointrush-client-ip': `192.0.2.${++address}`,
        ...(cookie ? { cookie } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }),
  );
}

function lastEmail(kind: AuthEmail['kind']): AuthEmail {
  const message = mailbox.filter((item) => item.kind === kind).at(-1);
  assert.ok(message);
  return message;
}

before(async () => {
  await migrate(db, { migrationsFolder: resolve('migrations') });
});
after(async () => {
  await pg.close();
});

test('reject unsafe auth configuration before creating a handler', () => {
  for (const change of [
    { secret: 'short' },
    { baseURL: 'http://public.example' },
    { trustedOrigins: ['https://*.example.com'] },
    { baseURL: 'https://example.com/path' },
  ]) {
    assert.throws(() =>
      createAuth(db, { ...config, ...change }, async () => {}),
    );
  }
});

test('real auth lifecycle: verified email, protected cookie, reset revocation and one-use reset', async () => {
  const email = 'member@example.test';
  const signup = await request('/sign-up/email', {
    email,
    password,
    name: 'Member',
  });
  assert.equal(signup.status, 200);
  assert.equal((await db.select().from(schema.authSessions)).length, 0);
  assert.equal((await db.select().from(schema.accounts)).length, 0);
  const [credential] = await db.select().from(schema.authCredentials);
  assert.ok(credential?.password);
  assert.notEqual(credential.password, password);
  assert.equal(
    (await request('/sign-in/email', { email, password })).status,
    403,
  );
  const verify = await auth.handler(new Request(lastEmail('verify-email').url));
  assert.ok(verify.status < 400);
  assert.equal((await db.select().from(schema.authSessions)).length, 0);

  const signin = await request('/sign-in/email', { email, password });
  assert.equal(signin.status, 200);
  const cookieHeader = signin.headers.get('set-cookie');
  assert.ok(cookieHeader);
  assert.match(cookieHeader, /HttpOnly/i);
  assert.match(cookieHeader, /Secure/i);
  assert.match(cookieHeader, /SameSite=Lax/i);
  const cookie = cookieHeader.split(';')[0];
  assert.ok(cookie);
  const session = await request('/get-session', undefined, cookie);
  assert.ok(await session.json());

  const reset = await request('/request-password-reset', {
    email,
    redirectTo: 'https://pointrush.test/reset-password',
  });
  assert.equal(reset.status, 200);
  const resetURL = new URL(lastEmail('reset-password').url);
  const token = resetURL.pathname.split('/').at(-1);
  assert.ok(token);
  const verifications = await db.select().from(schema.authVerifications);
  assert.ok(verifications.length > 0);
  assert.ok(verifications.every((row) => !row.identifier.includes(token)));
  const newPassword = 'A completely different passphrase 456!';
  assert.equal(
    (await request('/reset-password', { token, newPassword })).status,
    200,
  );
  assert.equal(
    await (await request('/get-session', undefined, cookie)).json(),
    null,
  );
  assert.equal(
    (await request('/reset-password', { token, newPassword })).status,
    400,
  );
  assert.equal(
    (await request('/sign-in/email', { email, password })).status,
    401,
  );
  const newSignin = await request('/sign-in/email', {
    email,
    password: newPassword,
  });
  assert.equal(newSignin.status, 200);
  const newCookie = newSignin.headers.get('set-cookie')?.split(';')[0];
  assert.ok(newCookie);
  assert.equal((await request('/sign-out', {}, newCookie)).status, 200);
  assert.equal(
    await (await request('/get-session', undefined, newCookie)).json(),
    null,
  );
});

test('reject weak passwords, untrusted origins, invalid reset tokens and redirects', async () => {
  assert.equal(
    (
      await request('/sign-up/email', {
        email: 'weak@example.test',
        password: 'short',
        name: 'Weak',
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await request('/sign-up/email', {
        email: 'long@example.test',
        password: 'x'.repeat(129),
        name: 'Long',
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await request(
        '/sign-in/email',
        { email: 'member@example.test', password },
        undefined,
        'https://evil.example',
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await request('/reset-password', {
        token: 'invalid',
        newPassword: password,
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await request('/request-password-reset', {
        email: 'member@example.test',
        redirectTo: 'https://evil.example',
      })
    ).status,
    403,
  );
});

test('unknown and existing reset requests have the same public response', async () => {
  const known = await request('/request-password-reset', {
    email: 'member@example.test',
  });
  const unknown = await request('/request-password-reset', {
    email: 'missing@example.test',
  });
  assert.equal(known.status, unknown.status);
  assert.deepEqual(await known.json(), await unknown.json());
});

test('expired sessions are not authenticated', async () => {
  const signin = await request('/sign-in/email', {
    email: 'member@example.test',
    password: 'A completely different passphrase 456!',
  });
  const cookie = signin.headers.get('set-cookie')?.split(';')[0];
  assert.ok(cookie);
  const sessions = await db.select().from(schema.authSessions);
  for (const session of sessions)
    await db
      .update(schema.authSessions)
      .set({ expiresAt: new Date(0) })
      .where(eq(schema.authSessions.id, session.id));
  assert.equal(
    await (await request('/get-session', undefined, cookie)).json(),
    null,
  );
});

test('email templates omit display names and sender config fails closed', () => {
  const content = authEmailContent({
    kind: 'verify-email',
    to: 'user@example.test',
    url: 'https://api.pointrush.test/verify?token=secret',
  });
  assert.match(content.text, /Never share this link/);
  assert.throws(() => createResendAuthEmail('', 'sender@example.test'));
  assert.throws(() =>
    createResendAuthEmail('test-key', 'invalid\r\nBcc: attacker@example.test'),
  );
});
