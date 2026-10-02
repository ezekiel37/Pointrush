import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { after, before, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import * as schema from '../src/database/schema.js';
import { SessionManagementService } from '../src/auth/session-management.js';

const pg = new PGlite();
const db = drizzle(pg, { schema });
const service = new SessionManagementService(db as never);
const userId = randomUUID();
const currentId = randomUUID();
const otherId = randomUUID();

before(async () => {
  await migrate(db, { migrationsFolder: resolve('migrations') });
  await db.insert(schema.authUsers).values({ id: userId, email: 'sessions@example.test', name: 'Sessions', emailVerified: true });
  await db.insert(schema.authSessions).values([
    { id: currentId, userId, token: 'current-token', expiresAt: new Date(Date.now() + 60_000), userAgent: 'current' },
    { id: otherId, userId, token: 'other-token', expiresAt: new Date(Date.now() + 60_000), userAgent: 'other' },
    { id: randomUUID(), userId, token: 'expired-token', expiresAt: new Date(Date.now() - 60_000), userAgent: 'expired' },
  ]);
});

after(async () => {
  await pg.close();
});

test('session controls list active metadata and revoke only the caller-owned sessions', async () => {
  const listed = await service.list(userId, currentId);
  assert.equal(listed.length, 2);
  assert.equal(listed.find((session) => session.id === currentId)?.current, true);
  assert.equal(listed.find((session) => session.id === currentId)?.userAgent, 'current');
  assert.deepEqual(await service.revoke(userId, otherId), { revoked: true });
  assert.deepEqual(await service.revoke(userId, otherId), { revoked: false });
  assert.deepEqual(await service.revokeOthers(userId, currentId), { revoked: 1 });
  assert.deepEqual(await service.revoke(userId, randomUUID()), { revoked: false });
});
