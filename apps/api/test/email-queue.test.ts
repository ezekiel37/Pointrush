import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { before, after, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { eq, sql } from 'drizzle-orm';
import * as schema from '../src/database/schema.js';
import { createAuth } from '../src/auth/auth.factory.js';
import { createQueuedAuthEmail } from '../src/auth/email-queue.js';
import { EmailPayloadCipher } from '../src/auth/email-payload.js';
import type { EmailPayload } from '../src/auth/email-payload.js';
import { EmailWorker } from '../src/auth/email-worker.js';
import { EmailDeliveryError } from '../src/auth/auth.email.js';

const pg = new PGlite();
const db = drizzle(pg, { schema });
const key = randomBytes(32).toString('hex');
const config = {
  secret: randomBytes(32).toString('hex'),
  baseURL: 'https://api.example.test',
  trustedOrigins: [],
};
const auth = createAuth(
  db,
  config,
  createQueuedAuthEmail(key, 'hello@example.test'),
);
let ip = 0;
const post = (path: string, body: Record<string, string>) =>
  auth.handler(
    new Request(`${config.baseURL}/api/v1/auth${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: config.baseURL,
        'x-pointrush-client-ip': `192.0.2.${++ip}`,
      },
      body: JSON.stringify(body),
    }),
  );
const signup = (email: string) =>
  post('/sign-up/email', {
    email,
    name: 'Queue User',
    password: 'A long test password for queue!',
  });

before(async () => {
  await migrate(db, { migrationsFolder: resolve('migrations') });
});
after(async () => {
  await pg.close();
});

test('signup commits encrypted queued mail without sending, and worker scrubs accepted payload', async () => {
  assert.equal((await signup('queue@example.test')).status, 200);
  const [job] = await db.select().from(schema.authEmailJobs);
  assert.ok(job?.payload);
  assert.ok(!job.payload.includes('queue@example.test'));
  assert.ok(!job.payload.includes('token='));
  const decrypted = new EmailPayloadCipher(key).open(job.id, job.payload);
  assert.equal(decrypted.to, 'queue@example.test');
  assert.match(decrypted.text, /token=/);
  let sent = 0;
  const worker = new EmailWorker(db, key, async (payload, deliveryKey) => {
    sent++;
    assert.deepEqual(payload, decrypted);
    assert.equal(deliveryKey, `auth-email/${job.id}`);
  });
  assert.equal(await worker.runOne(), 'accepted');
  assert.equal(await worker.runOne(), 'idle');
  assert.equal(sent, 1);
  const [accepted] = await db
    .select()
    .from(schema.authEmailJobs)
    .where(eq(schema.authEmailJobs.id, job.id));
  assert.equal(accepted?.payload, null);
  assert.equal(accepted?.state, 'accepted');
});

test('queue insertion failure rolls back signup rather than silently losing its email', async () => {
  await pg.exec(
    "CREATE FUNCTION reject_email_queue() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'forced queue failure'; END $$; CREATE TRIGGER reject_email_queue BEFORE INSERT ON auth_email_jobs FOR EACH ROW EXECUTE FUNCTION reject_email_queue()",
  );
  try {
    const response = await signup('rollback@example.test');
    assert.equal(response.status, 503);
    assert.ok(!(await response.text()).includes('forced queue failure'));
    assert.equal(
      (
        await db
          .select()
          .from(schema.authUsers)
          .where(eq(schema.authUsers.email, 'rollback@example.test'))
      ).length,
      0,
    );
  } finally {
    await pg.exec(
      'DROP TRIGGER reject_email_queue ON auth_email_jobs; DROP FUNCTION reject_email_queue()',
    );
  }
});

test('worker retry across instances preserves the entire payload and send key', async () => {
  await signup('retry@example.test');
  let firstPayload: EmailPayload | undefined;
  let firstKey: string | undefined;
  const failing = new EmailWorker(db, key, async (payload, deliveryKey) => {
    firstPayload = payload;
    firstKey = deliveryKey;
    throw new EmailDeliveryError(true, 120);
  });
  assert.equal(await failing.runOne(), 'retry');
  assert.equal(await failing.runOne(), 'idle');
  await db
    .update(schema.authEmailJobs)
    .set({ availableAt: new Date(0) })
    .where(eq(schema.authEmailJobs.state, 'pending'));
  const replacement = new EmailWorker(db, key, async (payload, deliveryKey) => {
    assert.deepEqual(payload, firstPayload);
    assert.equal(deliveryKey, firstKey);
  });
  assert.equal(await replacement.runOne(), 'accepted');
});

test('unexpired leases exclude another worker and expired leases can be recovered', async () => {
  await signup('lease@example.test');
  let sends = 0;
  const first = new EmailWorker(db, key, async () => {
    sends++;
  });
  const second = new EmailWorker(db, key, async () => {
    sends++;
  });
  const claim = await first.claim();
  assert.ok(claim);
  assert.equal(await second.runOne(), 'idle');
  await db
    .update(schema.authEmailJobs)
    .set({ leaseUntil: new Date(0) })
    .where(eq(schema.authEmailJobs.id, claim.id));
  assert.equal(await second.runOne(), 'accepted');
  assert.equal(sends, 1);
});

test('stale worker cannot acknowledge a lease reassigned after provider acceptance', async () => {
  await signup('stale@example.test');
  const deliveredKeys = new Set<string>();
  const worker = new EmailWorker(db, key, async (_payload, deliveryKey) => {
    deliveredKeys.add(deliveryKey);
    // Model a paused worker resuming after its lease was reassigned.
    await db
      .update(schema.authEmailJobs)
      .set({ leaseToken: 'replacement', leaseUntil: new Date(0) })
      .where(eq(schema.authEmailJobs.state, 'processing'));
  });
  assert.equal(await worker.runOne(), 'stale');
  assert.equal(
    await new EmailWorker(db, key, async (_payload, deliveryKey) => {
      deliveredKeys.add(deliveryKey);
    }).runOne(),
    'accepted',
  );
  assert.equal(deliveredKeys.size, 1);
});

test('expired or exhausted jobs never send; permanent failures stop retrying', async () => {
  await signup('expired@example.test');
  await db
    .update(schema.authEmailJobs)
    .set({ expiresAt: new Date(0) })
    .where(eq(schema.authEmailJobs.state, 'pending'));
  let sends = 0;
  const worker = new EmailWorker(db, key, async () => {
    sends++;
    throw new EmailDeliveryError(false);
  });
  assert.equal(await worker.runOne(), 'expired');
  assert.equal(sends, 0);
  await signup('exhausted@example.test');
  await db
    .update(schema.authEmailJobs)
    .set({ attempts: 5 })
    .where(eq(schema.authEmailJobs.state, 'pending'));
  assert.equal(await worker.runOne(), 'dead');
  assert.equal(sends, 0);
  await signup('permanent@example.test');
  assert.equal(await worker.runOne(), 'dead');
  assert.equal(await worker.runOne(), 'idle');
  assert.equal(sends, 1);
});

test('tampering, payload swaps and wrong keys fail closed without leaking plaintext', async () => {
  await signup('encrypted@example.test');
  const [job] = await db
    .select()
    .from(schema.authEmailJobs)
    .where(eq(schema.authEmailJobs.state, 'pending'));
  assert.ok(job?.payload);
  const cipher = new EmailPayloadCipher(key);
  const parts = job.payload.split('.');
  parts[3] = (parts[3]!.startsWith('A') ? 'B' : 'A') + parts[3]!.slice(1);
  assert.throws(
    () => cipher.open(job.id, parts.join('.')),
    /cannot be decrypted/,
  );
  assert.throws(
    () => cipher.open('another-id', job.payload!),
    /cannot be decrypted/,
  );
  assert.throws(
    () => cipher.open(job.id, job.payload!.replace('v1.', 'v2.')),
    /cannot be decrypted/,
  );
  let sent = false;
  assert.equal(
    await new EmailWorker(db, randomBytes(32).toString('hex'), async () => {
      sent = true;
    }).runOne(),
    'dead',
  );
  assert.equal(sent, false);
  const [dead] = await db
    .select()
    .from(schema.authEmailJobs)
    .where(eq(schema.authEmailJobs.id, job.id));
  assert.ok(
    dead?.payload,
    'preserve encrypted payload for key repair until expiry',
  );
  await db
    .update(schema.authEmailJobs)
    .set({
      expiresAt: new Date(0),
      createdAt: sql`clock_timestamp() - interval '8 days'`,
    })
    .where(eq(schema.authEmailJobs.id, job.id));
  await new EmailWorker(db, key, async () => {}).prune();
  assert.equal(
    (
      await db
        .select()
        .from(schema.authEmailJobs)
        .where(eq(schema.authEmailJobs.id, job.id))
    ).length,
    0,
  );
});
