import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { after, before, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { eq, sql } from 'drizzle-orm';
import { symmetricDecrypt } from 'better-auth/crypto';
import { Reflector } from '@nestjs/core';
import type { ExecutionContext } from '@nestjs/common';
import * as schema from '../src/database/schema.js';
import { createAuth } from '../src/auth/auth.factory.js';
import { AuthService } from '../src/auth/auth.service.js';
import { AdminMfaRequired, SessionGuard } from '../src/auth/session.guard.js';
import { hasRecentAdminMfa } from '../src/auth/admin-mfa.js';
import { AccountsService } from '../src/accounts/accounts.service.js';
import { AccountsRepository } from '../src/accounts/accounts.repository.js';

const pg = new PGlite();
const db = drizzle(pg, { schema });
const config = {
  secret: randomBytes(32).toString('hex'),
  baseURL: 'https://api.pointrush.test',
  trustedOrigins: ['https://pointrush.test'],
};
let verificationURL = '';
const auth = createAuth(db, config, async (message) => {
  verificationURL = message.url;
});
const password = 'Synthetic reviewer passphrase 123!';
let address = 0;
before(async () => {
  await migrate(db, { migrationsFolder: resolve('migrations') });
});
after(async () => {
  await pg.close();
});

function browser() {
  const cookies = new Map<string, string>();
  return {
    headers: () => ({
      cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join('; '),
    }),
    async request(path: string, body?: Record<string, unknown>) {
      const response = await auth.handler(
        new Request(`${config.baseURL}/api/v1/auth${path}`, {
          method: body ? 'POST' : 'GET',
          headers: {
            'content-type': 'application/json',
            origin: config.trustedOrigins[0]!,
            'x-pointrush-client-ip': `192.0.2.${++address}`,
            ...this.headers(),
          },
          ...(body ? { body: JSON.stringify(body) } : {}),
        }),
      );
      for (const cookie of response.headers.getSetCookie()) {
        const pair = cookie.split(';')[0]!;
        const split = pair.indexOf('=');
        const key = pair.slice(0, split);
        const value = pair.slice(split + 1);
        if (value) cookies.set(key, value);
        else cookies.delete(key);
      }
      return response;
    },
    session() {
      return auth.api.getSession({ headers: new Headers(this.headers()) });
    },
  };
}

test('real MFA enrollment, session-bound assurance, replay protection, backup login and expiry', async () => {
  const client = browser();
  const email = 'reviewer@example.test';
  assert.equal(
    (
      await client.request('/sign-up/email', {
        email,
        password,
        name: 'Reviewer',
      })
    ).status,
    200,
  );
  assert.ok((await auth.handler(new Request(verificationURL))).status < 400);
  assert.equal(
    (await client.request('/sign-in/email', { email, password })).status,
    200,
  );
  const initial = await client.session();
  assert.ok(initial);
  assert.equal(
    (await client.request('/two-factor/enable', { password })).status,
    403,
  );
  const accountService = new AccountsService(new AccountsRepository({ db }));
  const account = await accountService.createForAuth(initial.user.id, {
    username: 'reviewer_test',
    displayName: 'Reviewer',
  });
  const [grantor] = await db.insert(schema.accounts).values({}).returning();
  await db.insert(schema.taskReviewerGrants).values({
    reviewerId: account.id,
    grantedBy: grantor!.id,
    reason: 'Synthetic appointment',
    expiresAt: new Date(Date.now() + 86400000),
  });
  const enabled = await client.request('/two-factor/enable', { password });
  assert.equal(enabled.status, 200);
  const enrollment = (await enabled.json()) as {
    backupCodes: string[];
    totpURI: string;
  };
  const [factor] = await db
    .select()
    .from(schema.authTwoFactors)
    .where(eq(schema.authTwoFactors.userId, initial.user.id));
  assert.ok(factor);
  const secret = await symmetricDecrypt({
    key: config.secret,
    data: factor.secret,
  });
  assert.notEqual(secret, factor.secret);
  assert.ok(!factor.backupCodes.includes(enrollment.backupCodes[0]!));
  const { code } = await auth.api.generateTOTP({ body: { secret } });
  const wrong = code === '000000' ? '000001' : '000000';
  assert.equal(
    (await client.request('/two-factor/verify-totp', { code: wrong })).status,
    401,
  );
  assert.equal(
    await hasRecentAdminMfa(db, initial.session.id, initial.user.id),
    false,
  );
  assert.equal(
    (
      await client.request('/two-factor/verify-totp', {
        code,
        trustDevice: true,
      })
    ).status,
    403,
  );
  assert.equal(
    (await client.request('/two-factor/verify-totp', { code })).status,
    200,
  );
  const verified = await client.session();
  assert.ok(verified);
  assert.notEqual(verified.session.id, initial.session.id);
  assert.equal(
    await hasRecentAdminMfa(db, verified.session.id, verified.user.id),
    true,
  );
  assert.equal(
    await hasRecentAdminMfa(db, initial.session.id, initial.user.id),
    false,
  );
  assert.equal(
    (await client.request('/two-factor/verify-totp', { code })).status,
    403,
  );
  assert.equal(
    (await client.request('/two-factor/disable', { password })).status,
    403,
  );

  @AdminMfaRequired()
  class ProtectedController {}
  const guard = new SessionGuard(
    new Reflector(),
    accountService,
    new AuthService(auth, config.baseURL, config.trustedOrigins),
    { db },
  );
  function context(device: ReturnType<typeof browser>): ExecutionContext {
    return {
      getHandler: () => context,
      getClass: () => ProtectedController,
      switchToHttp: () => ({
        getRequest: () => ({ method: 'GET', headers: device.headers() }),
      }),
    } as unknown as ExecutionContext;
  }
  assert.equal(await guard.canActivate(context(client)), true);
  const second = browser();
  const login = await second.request('/sign-in/email', { email, password });
  assert.equal(login.status, 200);
  assert.equal(
    ((await login.json()) as { twoFactorRedirect: boolean }).twoFactorRedirect,
    true,
  );
  assert.equal(await second.session(), null);
  assert.equal(
    (
      await second.request('/two-factor/verify-backup-code', {
        code: enrollment.backupCodes[0],
      })
    ).status,
    200,
  );
  const recovered = await second.session();
  assert.ok(recovered);
  assert.equal(
    await hasRecentAdminMfa(db, recovered.session.id, recovered.user.id),
    false,
  );
  await assert.rejects(
    guard.canActivate(context(second)),
    /Recent authenticator/,
  );
  assert.equal(
    (await second.request('/two-factor/get-totp-uri', { password })).status,
    403,
  );
  await db
    .update(schema.authMfaSessions)
    .set({ verifiedAt: sql`clock_timestamp() - interval '16 minutes'` })
    .where(eq(schema.authMfaSessions.sessionId, verified.session.id));
  await assert.rejects(
    guard.canActivate(context(client)),
    /Recent authenticator/,
  );

  // Advance only synthetic replay retention; do not wait for a wall-clock OTP period.
  await db
    .update(schema.authMfaCodes)
    .set({ usedAt: sql`clock_timestamp() - interval '3 minutes'` });
  const fresh = await auth.api.generateTOTP({ body: { secret } });
  assert.equal(
    (await second.request('/two-factor/verify-totp', { code: fresh.code }))
      .status,
    200,
  );
  assert.equal(await guard.canActivate(context(second)), true);
  assert.equal((await second.request('/sign-out', {})).status, 200);
  assert.equal(
    await hasRecentAdminMfa(db, recovered.session.id, recovered.user.id),
    false,
  );
  assert.equal(
    (
      await db
        .select()
        .from(schema.authMfaSessions)
        .where(eq(schema.authMfaSessions.sessionId, recovered.session.id))
    ).length,
    0,
  );
  const third = browser();
  assert.equal(
    (await third.request('/sign-in/email', { email, password })).status,
    200,
  );
  assert.equal(await third.session(), null);
  await db
    .update(schema.authMfaCodes)
    .set({ usedAt: sql`clock_timestamp() - interval '3 minutes'` });
  const loginCode = await auth.api.generateTOTP({ body: { secret } });
  assert.equal(
    (await third.request('/two-factor/verify-totp', { code: loginCode.code }))
      .status,
    200,
  );
  const loggedIn = await third.session();
  assert.ok(loggedIn);
  assert.equal(await guard.canActivate(context(third)), true);
  // An expired underlying session invalidates even a fresh MFA assertion.
  await db
    .update(schema.authSessions)
    .set({ expiresAt: new Date(0) })
    .where(eq(schema.authSessions.id, loggedIn.session.id));
  assert.equal(
    await hasRecentAdminMfa(db, loggedIn.session.id, loggedIn.user.id),
    false,
  );
});
