import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import * as s from '../database/schema.js';
import type { FundingDatabase } from '../funding/funding-ledger.js';
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

// Support and safety tools for appointed reviewers with a recent
// authenticator check. Nothing here moves money.
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
    return this.reviewer(user, async (tx) => {
      const [found] = await tx
        .select({ accountId: s.usernames.accountId })
        .from(s.usernames)
        .where(eq(s.usernames.username, parsed.data));
      if (!found?.accountId) throw new NotFoundException();
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
    return this.reviewer(user, async (tx) => ({
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
    }));
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
}
