import { randomUUID } from 'node:crypto';
import { and, eq, inArray, lte, or, sql } from 'drizzle-orm';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import type * as schema from '../database/schema.js';
import { authEmailJobs as jobs } from './email-queue.schema.js';
import { EmailPayloadCipher } from './email-payload.js';
import type { SendEmailPayload } from './email-payload.js';
import { EmailDeliveryError } from './auth.email.js';

export class EmailWorker {
  private readonly cipher: EmailPayloadCipher;
  constructor(
    private readonly db: PgDatabase<PgQueryResultHKT, typeof schema>,
    key: string,
    private readonly send: SendEmailPayload,
  ) {
    this.cipher = new EmailPayloadCipher(key);
  }

  async claim() {
    return this.db.transaction(async (tx) => {
      const [job] = await tx
        .select()
        .from(jobs)
        .where(
          and(
            or(
              eq(jobs.state, 'pending'),
              and(
                eq(jobs.state, 'processing'),
                sql`${jobs.leaseUntil} <= clock_timestamp()`,
              ),
            ),
            sql`${jobs.availableAt} <= clock_timestamp()`,
          ),
        )
        .orderBy(jobs.availableAt, jobs.id)
        .limit(1)
        .for('update', { skipLocked: true });
      if (!job) return undefined;
      const [claimed] = await tx
        .update(jobs)
        .set({
          state: 'processing',
          leaseToken: randomUUID(),
          leaseUntil: sql`clock_timestamp() + interval '60 seconds'`,
        })
        .where(eq(jobs.id, job.id))
        .returning();
      return claimed;
    });
  }

  async runOne(): Promise<
    'idle' | 'accepted' | 'retry' | 'dead' | 'expired' | 'stale'
  > {
    const job = await this.claim();
    if (!job) return 'idle';
    const ownership = and(
      eq(jobs.id, job.id),
      eq(jobs.state, 'processing'),
      eq(jobs.leaseToken, job.leaseToken!),
      sql`${jobs.leaseUntil} > clock_timestamp()`,
    );
    // Database time decides expiration and attempt reservation immediately before sending.
    const [ready] = await this.db
      .update(jobs)
      .set({ attempts: sql`${jobs.attempts} + 1` })
      .where(
        and(
          ownership,
          sql`${jobs.expiresAt} > clock_timestamp() + interval '15 seconds'`,
          sql`${jobs.attempts} < 5`,
        ),
      )
      .returning();
    if (!ready) {
      const terminal = job.attempts >= 5 ? 'dead' : 'expired';
      const rows = await this.db
        .update(jobs)
        .set({
          state: terminal,
          payload: null,
          leaseToken: null,
          leaseUntil: null,
        })
        .where(ownership)
        .returning({ id: jobs.id });
      return rows.length ? terminal : 'stale';
    }
    let state: 'accepted' | 'retry' | 'dead' = 'accepted';
    let waitSeconds = 60 * 2 ** (ready.attempts - 1);
    let preservePayload = false;
    try {
      if (!ready.payload) throw new Error('Missing payload');
      let payload;
      try {
        payload = this.cipher.open(ready.id, ready.payload);
      } catch {
        // Preserve ciphertext so a wrong worker key can be repaired operationally.
        preservePayload = true;
        throw new Error('Invalid encrypted payload');
      }
      await this.send(payload, `auth-email/${ready.id}`);
    } catch (error) {
      state =
        error instanceof EmailDeliveryError &&
        error.retryable &&
        ready.attempts < 5
          ? 'retry'
          : 'dead';
      if (error instanceof EmailDeliveryError)
        waitSeconds = Math.max(waitSeconds, error.retryAfterSeconds);
    }
    const rows = await this.db
      .update(jobs)
      .set({
        state: state === 'retry' ? 'pending' : state,
        availableAt: sql`least(${jobs.expiresAt}, clock_timestamp() + ${Math.min(waitSeconds, 1200)} * interval '1 second')`,
        payload: state === 'retry' || preservePayload ? ready.payload : null,
        leaseToken: null,
        leaseUntil: null,
      })
      .where(ownership)
      .returning({ id: jobs.id });
    return rows.length ? state : 'stale';
  }

  async prune(): Promise<void> {
    await this.db
      .update(jobs)
      .set({ state: 'expired', payload: null })
      .where(
        and(
          eq(jobs.state, 'pending'),
          lte(jobs.expiresAt, sql`clock_timestamp()`),
        ),
      );
    // Dead jobs may retain ciphertext for key repair; scrub it at link expiry.
    await this.db
      .update(jobs)
      .set({ payload: null })
      .where(
        and(
          inArray(jobs.state, ['dead', 'expired', 'accepted']),
          lte(jobs.expiresAt, sql`clock_timestamp()`),
        ),
      );
    await this.db
      .delete(jobs)
      .where(
        and(
          inArray(jobs.state, ['dead', 'expired', 'accepted']),
          sql`${jobs.createdAt} < clock_timestamp() - interval '7 days'`,
        ),
      );
  }
}
