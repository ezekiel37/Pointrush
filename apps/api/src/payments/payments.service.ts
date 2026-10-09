import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { and, desc, eq, isNull, lt, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { FundingDatabase } from '../funding/funding-ledger.js';
import { postFundingTransfer } from '../funding/funding-ledger.js';
import * as s from '../database/schema.js';
import { checkMoneyPassword } from '../audit/audit.js';
import { actorTransaction } from '../tasks/actor-transaction.js';
import type { SecurityAlerts } from '../auth/security-alerts.js';
import { InvalidWebhook, ProviderError } from './provider.js';
import type {
  Bank,
  Destination,
  PaymentProvider,
  VerifiedEvent,
} from './provider.js';

const money = (min: bigint, max: bigint) =>
  z
    .string()
    .regex(/^[1-9][0-9]{0,14}$/)
    .transform(BigInt)
    .refine((v) => v >= min && v <= max);
const intentInput = z
  .object({ id: z.uuid(), amountKobo: money(100000n, 10000000000n) })
  .strict();
const withdrawalInput = z
  .object({ id: z.uuid(), amountKobo: money(100000n, 100000000n) })
  .strict();
const pageInput = z
  .object({
    after: z.uuid().optional(),
    limit: z
      .string()
      .regex(/^[1-9][0-9]?$/)
      .transform(Number)
      .pipe(z.number().max(50))
      .optional(),
  })
  .strict();
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new BadRequestException('Invalid payment input');
  return result.data;
}

type Outcome =
  | 'credited'
  | 'payout_paid'
  | 'payout_failed'
  | 'mismatch'
  | 'unknown_reference'
  | 'ignored';

// Money in: a recorded intent, then a verified webhook that must match it.
// Money out: an immediate ledger hold, settled only by the provider's result.
export class PaymentsService {
  constructor(
    private readonly db: FundingDatabase,
    private readonly provider?: PaymentProvider,
    private readonly alerts?: SecurityAlerts,
  ) {}

  private requireProvider() {
    if (!this.provider)
      throw new ServiceUnavailableException({
        statusCode: 503,
        message: 'Payments are not available yet',
        reason: 'payments_unavailable',
      });
    return this.provider;
  }

  async createFundingIntent(user: string, input: unknown) {
    const provider = this.requireProvider();
    const value = parse(intentInput, input);
    const intent = await actorTransaction(this.db, user, async (tx, actor) => {
      const [existing] = await tx
        .select()
        .from(s.fundingIntents)
        .where(eq(s.fundingIntents.id, value.id));
      if (existing) {
        if (
          existing.accountId !== actor ||
          existing.amountKobo !== value.amountKobo
        )
          throw new ConflictException('Funding request ID already used');
        return existing;
      }
      const [profile] = await tx
        .select({ id: s.sponsorProfiles.id })
        .from(s.sponsorProfiles)
        .where(eq(s.sponsorProfiles.ownerId, actor));
      if (!profile) throw new NotFoundException();
      return (
        await tx
          .insert(s.fundingIntents)
          .values({
            id: value.id,
            accountId: actor,
            provider: provider.name,
            amountKobo: value.amountKobo,
          })
          .returning()
      )[0]!;
    });
    if (intent.providerSessionId)
      throw new ConflictException({
        statusCode: 409,
        message: 'Checkout already started for this request; start a new one',
        reason: 'checkout_started',
      });
    const [business] = await this.db
      .select({
        name: s.sponsorProfiles.name,
        email: s.sponsorProfiles.contactEmail,
      })
      .from(s.sponsorProfiles)
      .where(eq(s.sponsorProfiles.ownerId, intent.accountId));
    // Never call a provider inside a database transaction.
    const checkout = await provider.createCheckout({
      intentId: intent.id,
      amountKobo: intent.amountKobo,
      ...(business ? { email: business.email, name: business.name } : {}),
    });
    await this.db
      .update(s.fundingIntents)
      .set({ providerSessionId: checkout.sessionId })
      .where(
        and(
          eq(s.fundingIntents.id, intent.id),
          isNull(s.fundingIntents.providerSessionId),
        ),
      );
    return {
      intentId: intent.id,
      amountKobo: intent.amountKobo.toString(),
      checkoutUrl: checkout.url,
    };
  }

  // Verified events are stored once per provider event ID; settlement is
  // idempotent on our own references, so replays never move money twice.
  async handleWebhook(
    providerName: string,
    rawBody: Buffer | undefined,
    headers: Record<string, string | string[] | undefined>,
  ) {
    const provider = this.requireProvider();
    if (providerName !== provider.name || !rawBody) throw new InvalidWebhook();
    const event = provider.verifyWebhook(rawBody, headers);
    return this.db.transaction(async (tx) => {
      // Concurrent deliveries of one event wait here, then see it as handled.
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`payment-event:${provider.name}:${event.eventId}`}, 0))`,
      );
      const [seen] = await tx
        .select({ outcome: s.paymentEvents.outcome })
        .from(s.paymentEvents)
        .where(
          and(
            eq(s.paymentEvents.provider, provider.name),
            eq(s.paymentEvents.eventId, event.eventId),
          ),
        );
      if (seen) return { outcome: seen.outcome, duplicate: true };
      const outcome = await this.settle(tx, event);
      await tx.insert(s.paymentEvents).values({
        provider: provider.name,
        eventId: event.eventId,
        type: event.type,
        reference: event.reference,
        amountKobo: event.amountKobo,
        currency: event.currency,
        outcome,
      });
      return { outcome, duplicate: false };
    });
  }

  private async settle(
    tx: FundingDatabase,
    event: VerifiedEvent,
  ): Promise<Outcome> {
    if (event.type === 'collection.succeeded') {
      if (!event.reference) return 'unknown_reference';
      const [intent] = await tx
        .select()
        .from(s.fundingIntents)
        .where(eq(s.fundingIntents.id, event.reference));
      if (!intent) return 'unknown_reference';
      if (
        event.amountKobo !== intent.amountKobo ||
        event.currency !== intent.currency ||
        (event.status != null && event.status !== 'SUCCEEDED')
      )
        return 'mismatch';
      await tx
        .insert(s.fundingAccounts)
        .values({ bucket: 'clearing' })
        .onConflictDoNothing();
      const [clearing] = await tx
        .select({ id: s.fundingAccounts.id })
        .from(s.fundingAccounts)
        .where(eq(s.fundingAccounts.bucket, 'clearing'));
      const [available] = await tx
        .select({ id: s.fundingAccounts.id })
        .from(s.fundingAccounts)
        .where(
          and(
            eq(s.fundingAccounts.ownerId, intent.accountId),
            eq(s.fundingAccounts.bucket, 'available'),
          ),
        );
      await postFundingTransfer(tx, {
        id: intent.id,
        sourceId: clearing!.id,
        destinationId: available!.id,
        actorId: intent.accountId,
        amountKobo: intent.amountKobo,
        kind: 'funding_confirmed',
        reference: `intent:${intent.id}`,
        reason: 'Provider-confirmed business funding',
      });
      return 'credited';
    }
    if (event.type === 'payout.succeeded' || event.type === 'payout.failed') {
      if (!event.reference) return 'unknown_reference';
      const [withdrawal] = await tx
        .select()
        .from(s.withdrawals)
        .where(eq(s.withdrawals.id, event.reference));
      if (!withdrawal) return 'unknown_reference';
      if (event.amountKobo !== withdrawal.amountKobo) return 'mismatch';
      const paid = event.type === 'payout.succeeded';
      // A settled withdrawal never changes. A repeat of the same result is a
      // no-op; a contradicting one is flagged for manual review.
      const [settled] = await tx
        .select({ outcome: s.withdrawalOutcomes.outcome })
        .from(s.withdrawalOutcomes)
        .where(eq(s.withdrawalOutcomes.withdrawalId, withdrawal.id));
      if (settled) {
        if ((settled.outcome === 'paid') !== paid) return 'mismatch';
        return paid ? 'payout_paid' : 'payout_failed';
      }
      await tx
        .insert(s.withdrawalOutcomes)
        .values({
          withdrawalId: withdrawal.id,
          outcome: paid ? 'paid' : 'failed',
          reason: paid
            ? 'Provider confirmed payout'
            : 'Provider reported failure',
        })
        .onConflictDoNothing();
      return paid ? 'payout_paid' : 'payout_failed';
    }
    return 'ignored';
  }

  // Re-entered password for a withdrawal; repeated failures pause it.
  checkPassword(user: string, verify: () => Promise<boolean>) {
    return checkMoneyPassword(this.db, user, 'withdrawal', verify);
  }

  async requestWithdrawal(user: string, input: unknown) {
    // Without a provider a hold could never be paid out or returned.
    this.requireProvider();
    const value = parse(withdrawalInput, input);
    return actorTransaction(this.db, user, async (tx, actor) => {
      const [existing] = await tx
        .select()
        .from(s.withdrawals)
        .where(eq(s.withdrawals.id, value.id));
      if (existing) {
        if (
          existing.accountId !== actor ||
          existing.amountKobo !== value.amountKobo
        )
          throw new ConflictException('Withdrawal ID already used');
        return this.withdrawalResult(tx, existing.id);
      }
      const [destination] = await tx
        .select({ id: s.payoutDestinations.id })
        .from(s.payoutDestinations)
        .where(eq(s.payoutDestinations.accountId, actor))
        .orderBy(
          desc(s.payoutDestinations.createdAt),
          desc(s.payoutDestinations.id),
        )
        .limit(1);
      if (!destination)
        throw new ConflictException({
          statusCode: 409,
          message: 'Add a bank account before withdrawing',
          reason: 'destination_required',
        });
      await tx.insert(s.withdrawals).values({
        id: value.id,
        accountId: actor,
        amountKobo: value.amountKobo,
        destinationId: destination.id,
      });
      return this.withdrawalResult(tx, value.id);
    });
  }

  private withdrawalFields() {
    return {
      id: s.withdrawals.id,
      amountKobo: sql<string>`${s.withdrawals.amountKobo}::text`,
      createdAt: s.withdrawals.createdAt,
      bank: sql<
        string | null
      >`(select d.bank_name || ' ••••' || d.account_last4 from payout_destinations d where d.id = ${s.withdrawals.destinationId})`,
      state: sql<'held' | 'sent' | 'paid' | 'failed'>`case
        when exists (select 1 from withdrawal_outcomes o where o.withdrawal_id = ${s.withdrawals.id} and o.outcome = 'paid') then 'paid'
        when exists (select 1 from withdrawal_outcomes o where o.withdrawal_id = ${s.withdrawals.id} and o.outcome = 'failed') then 'failed'
        when exists (select 1 from withdrawal_submissions w where w.withdrawal_id = ${s.withdrawals.id}) then 'sent'
        else 'held' end`,
    };
  }

  private async withdrawalResult(tx: FundingDatabase, id: string) {
    const [row] = await tx
      .select(this.withdrawalFields())
      .from(s.withdrawals)
      .where(eq(s.withdrawals.id, id));
    return row!;
  }

  async withdrawalList(user: string, input: unknown = {}) {
    const query = parse(pageInput, input);
    const limit = query.limit ?? 25;
    return actorTransaction(this.db, user, async (tx, actor) => {
      const rows = await tx
        .select(this.withdrawalFields())
        .from(s.withdrawals)
        .where(
          and(
            eq(s.withdrawals.accountId, actor),
            query.after ? lt(s.withdrawals.id, query.after) : undefined,
          ),
        )
        .orderBy(desc(s.withdrawals.createdAt))
        .limit(limit + 1);
      return {
        items: rows.slice(0, limit),
        nextCursor: rows.length > limit ? rows[limit - 1]!.id : null,
      };
    });
  }

  private banksCache: { at: number; banks: Bank[] } | null = null;
  async banks() {
    const provider = this.requireProvider();
    if (!this.banksCache || Date.now() - this.banksCache.at > 86400000)
      this.banksCache = { at: Date.now(), banks: await provider.listBanks() };
    return { items: this.banksCache.banks };
  }

  async destination(user: string) {
    return actorTransaction(this.db, user, async (tx, actor) => {
      const [row] = await tx
        .select()
        .from(s.payoutDestinations)
        .where(eq(s.payoutDestinations.accountId, actor))
        .orderBy(
          desc(s.payoutDestinations.createdAt),
          desc(s.payoutDestinations.id),
        )
        .limit(1);
      const locked = await this.isLocked(tx, actor);
      if (!row) return { destination: null, locked };
      const [older] = await tx
        .select({ id: s.payoutDestinations.id })
        .from(s.payoutDestinations)
        .where(
          and(
            eq(s.payoutDestinations.accountId, actor),
            sql`${s.payoutDestinations.id} <> ${row.id}`,
          ),
        )
        .limit(1);
      return {
        destination: {
          id: row.id,
          bankName: row.bankName,
          accountName: row.accountName,
          last4: row.accountLast4,
          // A changed account waits 24 hours before it can receive money.
          usableFrom: older
            ? new Date(row.createdAt.getTime() + 86400000)
            : row.createdAt,
        },
        locked,
      };
    });
  }

  private async isLocked(tx: FundingDatabase, accountId: string) {
    const [lock] = await tx
      .select({ id: s.withdrawalLocks.id })
      .from(s.withdrawalLocks)
      .where(
        and(
          eq(s.withdrawalLocks.accountId, accountId),
          sql`not exists (select 1 from withdrawal_unlocks u where u.lock_id = ${s.withdrawalLocks.id})`,
        ),
      )
      .limit(1);
    return Boolean(lock);
  }

  // "This wasn't me": stops every withdrawal until a reviewer checks.
  async lockWithdrawals(user: string) {
    const accountId = await actorTransaction(
      this.db,
      user,
      async (tx, actor) => {
        if (!(await this.isLocked(tx, actor)))
          await tx.insert(s.withdrawalLocks).values({
            id: randomUUID(),
            accountId: actor,
            reason: 'Locked by the account owner from the wallet',
          });
        // Withdrawals not yet sent to the bank are stopped; the money returns
        // to the wallet.
        await tx.execute(sql`
          insert into withdrawal_outcomes (withdrawal_id, outcome, reason)
          select w.id, 'failed', 'Stopped: withdrawals locked by the account owner'
          from withdrawals w
          where w.account_id = ${actor}
            and not exists (select 1 from withdrawal_submissions x where x.withdrawal_id = w.id)
            and not exists (select 1 from withdrawal_outcomes o where o.withdrawal_id = w.id)
          on conflict do nothing`);
        return actor;
      },
    );
    await this.alerts
      ?.notify(
        accountId,
        'Withdrawals from your Acticlaim wallet are locked',
        'You locked withdrawals. Your balance is safe. Acticlaim support will check your account and contact you before withdrawals open again.',
      )
      .catch(() => undefined);
    return { locked: true };
  }

  // The provider checks the account at the bank first; only then is it saved.
  async addDestination(user: string, input: unknown) {
    const provider = this.requireProvider();
    const value = parse(
      z
        .object({
          bankCode: z.string().regex(/^[0-9A-Za-z]{2,20}$/),
          accountNumber: z.string().regex(/^\d{10}$/),
        })
        .strict(),
      input,
    );
    // Confirms the person may act before calling the provider at all.
    await actorTransaction(this.db, user, async () => undefined);
    let found: Destination;
    try {
      found = await provider.addDestination(value);
    } catch (error) {
      if (error instanceof ProviderError && error.permanent)
        throw new ConflictException({
          statusCode: 409,
          message: 'The bank could not find this account',
          reason: 'account_not_found',
        });
      throw new ServiceUnavailableException({
        statusCode: 503,
        message: 'The bank could not be reached; try again shortly',
        reason: 'bank_unavailable',
      });
    }
    const accountId = await actorTransaction(
      this.db,
      user,
      async (tx, actor) => {
        await tx.insert(s.payoutDestinations).values({
          id: randomUUID(),
          accountId: actor,
          provider: provider.name,
          providerDestinationId: found.destinationId,
          bankCode: value.bankCode,
          bankName: found.bankName.slice(0, 120),
          accountName: found.accountName.slice(0, 160),
          accountLast4: found.last4,
        });
        return actor;
      },
    );
    // Every bank account change is told to the owner, so a thief who took
    // over the account cannot redirect money quietly.
    await this.alerts
      ?.notify(
        accountId,
        'A bank account was added to your Acticlaim wallet',
        `${found.accountName}, ${found.bankName} ending ${found.last4}, can now receive your withdrawals. If you already had a bank account, the new one can receive money after 24 hours.`,
      )
      .catch(() => undefined);
    return this.destination(user);
  }

  // Worker step: hand held withdrawals to the provider, once each. The
  // withdrawal ID is the provider idempotency key: if this process stops after
  // the provider accepts but before the submission is stored, the next run
  // gets the same payout back rather than sending a second one.
  async submitPendingWithdrawals(limit = 20) {
    const provider = this.requireProvider();
    const pending = await this.db
      .select({
        id: s.withdrawals.id,
        amountKobo: s.withdrawals.amountKobo,
        destination: s.payoutDestinations.providerDestinationId,
        destinationProvider: s.payoutDestinations.provider,
      })
      .from(s.withdrawals)
      .leftJoin(
        s.payoutDestinations,
        eq(s.payoutDestinations.id, s.withdrawals.destinationId),
      )
      .where(
        sql`not exists (select 1 from withdrawal_submissions w where w.withdrawal_id = ${s.withdrawals.id})
          and not exists (select 1 from withdrawal_outcomes o where o.withdrawal_id = ${s.withdrawals.id})
          and not exists (select 1 from withdrawal_locks l where l.account_id = ${s.withdrawals.accountId}
            and not exists (select 1 from withdrawal_unlocks u where u.lock_id = l.id))`,
      )
      .orderBy(s.withdrawals.createdAt)
      .limit(limit);
    const result = { submitted: 0, failed: 0, deferred: 0 };
    const fail = async (id: string, reason: string) => {
      await this.db
        .insert(s.withdrawalOutcomes)
        .values({ withdrawalId: id, outcome: 'failed', reason })
        .onConflictDoNothing();
      result.failed += 1;
    };
    for (const withdrawal of pending) {
      if (
        !withdrawal.destination ||
        withdrawal.destinationProvider !== provider.name
      ) {
        // No bank account this provider knows: return the money.
        await fail(withdrawal.id, 'No usable bank account');
        continue;
      }
      let payout: { payoutId: string };
      try {
        payout = await provider.createPayout({
          withdrawalId: withdrawal.id,
          destinationId: withdrawal.destination,
          amountKobo: withdrawal.amountKobo,
        });
      } catch (error) {
        if (error instanceof ProviderError && error.permanent)
          await fail(
            withdrawal.id,
            `Payout refused: ${error.code}`.slice(0, 300),
          );
        // Anything else (provider down, our balance short) stays held and is
        // retried with the same key on the next run.
        else result.deferred += 1;
        continue;
      }
      const [row] = await this.db
        .insert(s.withdrawalSubmissions)
        .values({
          withdrawalId: withdrawal.id,
          provider: provider.name,
          providerPayoutId: payout.payoutId,
        })
        .onConflictDoNothing()
        .returning();
      if (row) result.submitted += 1;
    }
    return result;
  }
}
