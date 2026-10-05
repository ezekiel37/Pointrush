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
import { actorTransaction } from '../tasks/actor-transaction.js';
import { InvalidWebhook } from './provider.js';
import type { PaymentProvider, VerifiedEvent } from './provider.js';

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
  .object({ id: z.uuid(), amountKobo: money(50000n, 500000000n) })
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
    // Never call a provider inside a database transaction.
    const checkout = await provider.createCheckout({
      intentId: intent.id,
      amountKobo: intent.amountKobo,
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
        event.currency !== intent.currency
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

  async requestWithdrawal(user: string, input: unknown) {
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
      await tx.insert(s.withdrawals).values({
        id: value.id,
        accountId: actor,
        amountKobo: value.amountKobo,
      });
      return this.withdrawalResult(tx, value.id);
    });
  }

  private withdrawalFields() {
    return {
      id: s.withdrawals.id,
      amountKobo: sql<string>`${s.withdrawals.amountKobo}::text`,
      createdAt: s.withdrawals.createdAt,
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

  // Worker step: hand held withdrawals to the provider, once each.
  async submitPendingWithdrawals(limit = 20) {
    const provider = this.requireProvider();
    const pending = await this.db
      .select()
      .from(s.withdrawals)
      .where(
        sql`not exists (select 1 from withdrawal_submissions w where w.withdrawal_id = ${s.withdrawals.id})
          and not exists (select 1 from withdrawal_outcomes o where o.withdrawal_id = ${s.withdrawals.id})`,
      )
      .orderBy(s.withdrawals.createdAt)
      .limit(limit);
    let submitted = 0;
    for (const withdrawal of pending) {
      // The withdrawal ID is the provider idempotency key: if this process
      // stops after the provider accepts but before the submission is stored,
      // the retry must return the same payout rather than send a second one.
      // Every real adapter is required to honour this (see PAYMENTS.md).
      const payout = await provider.createPayout({
        withdrawalId: withdrawal.id,
        accountId: withdrawal.accountId,
        amountKobo: withdrawal.amountKobo,
      });
      const [row] = await this.db
        .insert(s.withdrawalSubmissions)
        .values({
          withdrawalId: withdrawal.id,
          provider: provider.name,
          providerPayoutId: payout.payoutId,
        })
        .onConflictDoNothing()
        .returning();
      if (row) submitted += 1;
    }
    return { submitted };
  }
}
