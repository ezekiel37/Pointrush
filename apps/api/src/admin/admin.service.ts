import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import * as s from '../database/schema.js';
import type { FundingDatabase } from '../funding/funding-ledger.js';
import { recordAudit } from '../audit/audit.js';
import { actorTransaction } from '../tasks/actor-transaction.js';

type Row = Record<string, unknown>;
const rows = (result: unknown) =>
  ((result as { rows?: Row[] }).rows ?? (result as Row[])) as Row[];
const iso = (value: unknown) => new Date(String(value)).toISOString();

const accessInput = z
  .object({
    id: z.uuid(),
    toState: z.enum(['active', 'suspended']),
    reason: z.string().trim().min(3).max(500),
  })
  .strict();
const noteInput = z
  .object({ note: z.string().trim().min(3).max(1000) })
  .strict();

const rulingInput = z
  .object({
    decision: z.enum(['upheld', 'reversed']),
    reason: z.string().trim().min(3).max(500),
  })
  .strict();

// Support and safety tools for appointed reviewers with a recent
// authenticator check. Only a reversed void ruling moves money: the shopper
// is paid from the campaign's locked funds, never from Acticlaim's.
export class AdminService {
  constructor(private readonly db: FundingDatabase) {}

  private async reviewer<T>(
    user: string,
    action: (tx: FundingDatabase, actor: string) => Promise<T>,
  ) {
    return actorTransaction(this.db, user, async (tx, actor) => {
      const [allowed] = rows(
        await tx.execute(sql`select staff_reviewer_active(${actor}) as ok`),
      );
      if (!allowed?.ok)
        throw new ForbiddenException('Reviewer appointment required');
      return action(tx, actor);
    });
  }

  private async accountView(tx: FundingDatabase, accountId: string) {
    const [account] = rows(
      await tx.execute(sql`
        select a.id, a.access_state, a.created_at, u.username, p.display_name,
          exists (select 1 from verified_phones v where v.account_id = a.id) as phone_verified,
          exists (select 1 from sponsor_profiles sp where sp.owner_id = a.id) as business,
          exists (select 1 from withdrawal_locks l where l.account_id = a.id
            and not exists (select 1 from withdrawal_unlocks u where u.lock_id = l.id)) as withdrawals_locked
        from accounts a
        left join usernames u on u.account_id = a.id and u.is_current
        left join account_profiles p on p.account_id = a.id
        where a.id = ${accountId}`),
    );
    if (!account) throw new NotFoundException();
    const history = rows(
      await tx.execute(sql`
        select c.from_state, c.to_state, c.reason, c.created_at, u.username as actor
        from account_access_changes c
        left join usernames u on u.account_id = c.actor_id and u.is_current
        where c.account_id = ${accountId}
        order by c.created_at desc limit 20`),
    ).map((r) => ({
      fromState: String(r.from_state),
      toState: String(r.to_state),
      reason: String(r.reason),
      by: r.actor == null ? null : String(r.actor),
      at: iso(r.created_at),
    }));
    return {
      id: String(account.id),
      username: account.username == null ? null : String(account.username),
      displayName:
        account.display_name == null ? null : String(account.display_name),
      accessState: String(account.access_state),
      phoneVerified: Boolean(account.phone_verified),
      business: Boolean(account.business),
      withdrawalsLocked: Boolean(account.withdrawals_locked),
      createdAt: iso(account.created_at),
      history,
    };
  }

  async findAccount(user: string, username: unknown) {
    const parsed = z
      .string()
      .trim()
      .transform((v) => v.replace(/^@/, '').toLowerCase())
      .pipe(z.string().regex(/^[a-z0-9_]{3,20}$/))
      .safeParse(username);
    if (!parsed.success) throw new BadRequestException('Enter a username');
    return this.reviewer(user, async (tx, actor) => {
      const [found] = await tx
        .select({ accountId: s.usernames.accountId })
        .from(s.usernames)
        .where(eq(s.usernames.username, parsed.data));
      if (!found?.accountId) throw new NotFoundException();
      // Reviewers' look-ups are recorded: who looked at whose account.
      await recordAudit(tx, {
        kind: 'admin_account_viewed',
        subject: found.accountId,
        actor,
      });
      return this.accountView(tx, found.accountId);
    });
  }

  async setAccess(user: string, accountId: string, input: unknown) {
    if (!z.uuid().safeParse(accountId).success) throw new NotFoundException();
    const parsed = accessInput.safeParse(input);
    if (!parsed.success)
      throw new BadRequestException('Choose a state and give a reason');
    const value = parsed.data;
    return this.reviewer(user, async (tx, actor) => {
      const [existing] = await tx
        .select()
        .from(s.accountAccessChanges)
        .where(eq(s.accountAccessChanges.id, value.id));
      if (!existing)
        await tx.insert(s.accountAccessChanges).values({
          id: value.id,
          accountId,
          toState: value.toState,
          reason: value.reason,
          actorId: actor,
        });
      else if (existing.accountId !== accountId) throw new NotFoundException();
      return this.accountView(tx, accountId);
    });
  }

  // A reviewer reopens withdrawals after checking a "this wasn't me" lock.
  async unlockWithdrawals(user: string, accountId: string) {
    if (!z.uuid().safeParse(accountId).success) throw new NotFoundException();
    return this.reviewer(user, async (tx, actor) => {
      const open = rows(
        await tx.execute(sql`
          select l.id from withdrawal_locks l where l.account_id = ${accountId}
            and not exists (select 1 from withdrawal_unlocks u where u.lock_id = l.id)`),
      );
      for (const lock of open)
        await tx
          .insert(s.withdrawalUnlocks)
          .values({ lockId: String(lock.id), actorId: actor });
      return this.accountView(tx, accountId);
    });
  }

  async flaggedPayments(user: string) {
    return this.reviewer(user, async (tx, actor) => {
      await recordAudit(tx, {
        kind: 'admin_payments_viewed',
        subject: actor,
        actor,
      });
      return {
        items: rows(
          await tx.execute(sql`
          select e.id, e.provider, e.event_id, e.type, e.reference, e.amount_kobo::text as amount_kobo,
            e.currency, e.outcome, e.received_at, r.note, r.created_at as reviewed_at
          from payment_events e
          left join payment_event_reviews r on r.event_id = e.id
          where e.outcome in ('mismatch', 'unknown_reference')
          order by (r.event_id is null) desc, e.received_at desc
          limit 100`),
        ).map((r) => ({
          id: String(r.id),
          provider: String(r.provider),
          eventId: String(r.event_id),
          type: String(r.type),
          reference: r.reference == null ? null : String(r.reference),
          amountKobo: r.amount_kobo == null ? null : String(r.amount_kobo),
          currency: r.currency == null ? null : String(r.currency),
          outcome: String(r.outcome),
          receivedAt: iso(r.received_at),
          review:
            r.note == null
              ? null
              : { note: String(r.note), at: iso(r.reviewed_at) },
        })),
      };
    });
  }

  async reviewPayment(user: string, eventId: string, input: unknown) {
    if (!z.uuid().safeParse(eventId).success) throw new NotFoundException();
    const parsed = noteInput.safeParse(input);
    if (!parsed.success) throw new BadRequestException('Write what you found');
    return this.reviewer(user, async (tx, actor) => {
      await tx
        .insert(s.paymentEventReviews)
        .values({ eventId, reviewerId: actor, note: parsed.data.note });
      return { eventId, reviewed: true };
    });
  }

  // Shoppers' disputes of voided cash back, oldest first, with the business's
  // void record on that campaign for context.
  async voidDisputes(user: string) {
    return this.reviewer(user, async (tx, actor) => {
      await recordAudit(tx, {
        kind: 'admin_disputes_viewed',
        subject: actor,
        actor,
      });
      return {
        items: rows(
          await tx.execute(sql`
          select p.id, t.title, sp.name as business, u.username as shopper,
            p.amount_kobo::text as amount_kobo, t.reward_kobo::text as cashback_kobo,
            p.created_at as purchased_at, v.reason as void_reason, v.created_at as voided_at,
            d.note, d.created_at as disputed_at,
            (select count(*)::int from purchase_confirmations c where c.task_id = t.id) as confirmed,
            (select count(*)::int from purchase_voids x join purchase_confirmations c on c.id = x.confirmation_id
              where c.task_id = t.id) as voided
          from purchase_void_disputes d
          join purchase_confirmations p on p.id = d.confirmation_id
          join purchase_voids v on v.confirmation_id = p.id
          join sponsor_tasks t on t.id = p.task_id
          join sponsor_profiles sp on sp.id = t.sponsor_id
          left join usernames u on u.account_id = p.account_id and u.is_current
          where not exists (select 1 from purchase_void_rulings r where r.confirmation_id = d.confirmation_id)
          order by d.created_at
          limit 100`),
        ).map((r) => ({
          id: String(r.id),
          title: String(r.title),
          business: String(r.business),
          shopper: r.shopper == null ? null : String(r.shopper),
          amountKobo: String(r.amount_kobo),
          cashbackKobo: String(r.cashback_kobo),
          purchasedAt: iso(r.purchased_at),
          voidReason: String(r.void_reason),
          voidedAt: iso(r.voided_at),
          note: String(r.note),
          disputedAt: iso(r.disputed_at),
          campaignConfirmed: Number(r.confirmed),
          campaignVoided: Number(r.voided),
        })),
      };
    });
  }

  async ruleOnVoid(user: string, confirmationId: string, input: unknown) {
    if (!z.uuid().safeParse(confirmationId).success)
      throw new NotFoundException();
    const parsed = rulingInput.safeParse(input);
    if (!parsed.success) throw new BadRequestException('Invalid ruling');
    return this.reviewer(user, async (tx, actor) => {
      const [existing] = await tx
        .select()
        .from(s.purchaseVoidRulings)
        .where(eq(s.purchaseVoidRulings.confirmationId, confirmationId));
      if (existing) {
        if (existing.decision !== parsed.data.decision)
          throw new BadRequestException('Dispute already decided');
        return { id: confirmationId, decision: existing.decision };
      }
      await tx.insert(s.purchaseVoidRulings).values({
        confirmationId,
        reviewerId: actor,
        decision: parsed.data.decision,
        reason: parsed.data.reason,
      });
      return { id: confirmationId, decision: parsed.data.decision };
    });
  }
}
