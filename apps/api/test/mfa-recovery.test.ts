import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { after, before, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { eq } from 'drizzle-orm';
import * as schema from '../src/database/schema.js';
import { MfaRecoveryService } from '../src/auth/mfa-recovery.js';

const pg = new PGlite();
const db = drizzle(pg, { schema });
const service = new MfaRecoveryService(db as never);
let operatorId: string;
let targetUserId: string;

before(async () => {
  await migrate(db, { migrationsFolder: resolve('migrations') });
  const operatorUserId = randomUUID();
  targetUserId = randomUUID();
  await db.insert(schema.authUsers).values([
    {
      id: operatorUserId,
      email: 'mfa-operator@example.test',
      name: 'Operator',
      emailVerified: true,
    },
    {
      id: targetUserId,
      email: 'mfa-target@example.test',
      name: 'Target',
      emailVerified: true,
      twoFactorEnabled: true,
    },
  ]);
  const [operator] = await db.insert(schema.accounts).values({}).returning();
  assert.ok(operator);
  operatorId = operator.id;
  await db
    .insert(schema.authAccountLinks)
    .values({ accountId: operator.id, authUserId: operatorUserId });
  const [factor] = await db
    .insert(schema.authTwoFactors)
    .values({
      id: randomUUID(),
      userId: targetUserId,
      secret: 'synthetic-secret',
      backupCodes: 'synthetic-backup',
      verified: true,
    })
    .returning();
  assert.ok(factor);
  await db.insert(schema.authSessions).values({
    id: randomUUID(),
    userId: targetUserId,
    token: 'synthetic-session-token',
    expiresAt: new Date(Date.now() + 60_000),
  });
});

after(async () => {
  await pg.close();
});

test('operator recovery is audited, idempotent and revokes factor-bound sessions', async () => {
  const requestId = randomUUID();
  const input = {
    requestId,
    operatorAccountId: operatorId,
    targetAuthUserId: targetUserId,
    reason: 'Synthetic lost-device recovery',
    evidenceRef: 'case:test-001',
  };
  const event = await service.resetFactor(input);
  assert.equal(event.requestId, requestId);
  assert.equal((await db.select().from(schema.authTwoFactors)).length, 0);
  assert.equal((await db.select().from(schema.authSessions)).length, 0);
  assert.equal(
    (
      await db
        .select()
        .from(schema.authUsers)
        .where(eq(schema.authUsers.id, targetUserId))
    )[0]?.twoFactorEnabled,
    false,
  );
  assert.equal((await service.resetFactor(input)).id, event.id);
  await assert.rejects(
    service.resetFactor({ ...input, reason: 'Changed request' }),
    /already bound/,
  );
  await assert.rejects(
    db
      .update(schema.authMfaRecoveryEvents)
      .set({ reason: 'tampered' })
      .where(eq(schema.authMfaRecoveryEvents.id, event.id)),
    /immutable|Failed query/,
  );
});
