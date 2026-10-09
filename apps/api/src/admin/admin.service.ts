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
import {
  defaultSettings,
  parseSettings,
  readSettings,
} from '../settings/settings.js';
import { platformSettings } from '../settings/settings.schema.js';

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

const settingsChange = z
  .object({
    settings: z.unknown(),
    reason: z.string().trim().min(3).max(500),
  })
  .strict();
const searchInput = z.string().trim().min(2).max(80);

// Who may change settings: named reviewer accounts only (see
// SETTINGS_ADMIN_ACCOUNT_IDS). Read at each change so a removal applies at once.
function settingsAdmins() {
  return (process.env.SETTINGS_ADMIN_ACCOUNT_IDS ?? '')
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
}

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

  // Minimums and referral rewards, with who changed them and why.
  async settings(user: string) {
    return this.reviewer(user, async (tx, actor) => {
      const current = await readSettings(tx);
      const history = rows(
        await tx.execute(sql`
          select ps.id, ps.reason, ps.created_at, u.username as actor
          from platform_settings ps
          left join usernames u on u.account_id = ps.actor_id and u.is_current
          order by ps.version desc limit 20`),
      ).map((r) => ({
        id: String(r.id),
        reason: String(r.reason),
        by: r.actor == null ? null : String(r.actor),
        at: iso(r.created_at),
      }));
      return {
        current,
        defaults: defaultSettings,
        canEdit: settingsAdmins().includes(actor),
        history,
      };
    });
  }

  async updateSettings(user: string, input: unknown) {
    const parsed = settingsChange.safeParse(input);
    if (!parsed.success)
      throw new BadRequestException('Give the new settings and a reason');
    const next = parseSettings(parsed.data.settings);
    return this.reviewer(user, async (tx, actor) => {
      if (!settingsAdmins().includes(actor))
        throw new ForbiddenException({
          statusCode: 403,
          message: 'You can view settings but not change them',
          reason: 'settings_read_only',
        });
      const [row] = await tx
        .insert(platformSettings)
        .values({ settings: next, actorId: actor, reason: parsed.data.reason })
        .returning();
      await recordAudit(tx, {
        kind: 'admin_settings_changed',
        subject: row!.id,
        actor,
      });
      return { id: row!.id, current: next };
    });
  }

  // Platform totals from the ledger and records; nothing is estimated.
  async analytics(user: string) {
    return this.reviewer(user, async (tx) => {
      const [r] = rows(
        await tx.execute(sql`
          with lagos as (select clock_timestamp() as now)
          select
            (select count(*) from accounts)::int as accounts,
            (select count(*) from accounts, lagos where created_at > lagos.now - interval '7 days')::int as accounts_7d,
            (select count(*) from accounts, lagos where created_at > lagos.now - interval '30 days')::int as accounts_30d,
            (select count(*) from verified_phones)::int as verified_phones,
            (select count(*) from sponsor_profiles)::int as businesses,
            (select count(*) from sponsor_profiles, lagos where terms_accepted_at > lagos.now - interval '30 days')::int as businesses_30d,
            (select count(*) from sponsor_tasks t where exists (select 1 from task_publications p where p.task_id = t.id)
              and t.ends_at > clock_timestamp())::int as live_campaigns,
            (select count(*) from purchase_confirmations)::int as purchases,
            (select count(*) from purchase_confirmations, lagos where created_at > lagos.now - interval '7 days')::int as purchases_7d,
            (select count(*) from claim_redemptions)::int as prize_claims,
            coalesce((select sum(amount_kobo) from funding_transfers where kind = 'funding_confirmed'), 0)::text as funded,
            coalesce((select sum(amount_kobo) from funding_transfers where kind = 'funding_confirmed'
              and created_at > clock_timestamp() - interval '30 days'), 0)::text as funded_30d,
            coalesce((select sum(case when f.destination_id = a.id then f.amount_kobo else -f.amount_kobo end)
              from funding_accounts a join funding_transfers f on f.source_id = a.id or f.destination_id = a.id
              where a.bucket = 'task_locked'), 0)::text as locked,
            coalesce((select sum(amount_kobo) from funding_transfers
              where kind in ('purchase_cashback', 'prize_claim', 'task_reward', 'void_reversal', 'prize_cash_value', 'referral_cashback')), 0)::text as paid_to_users,
            coalesce((select sum(case when f.destination_id = a.id then f.amount_kobo else -f.amount_kobo end)
              from funding_accounts a join funding_transfers f on f.source_id = a.id or f.destination_id = a.id
              where a.bucket = 'reward_wallet'), 0)::text as in_wallets,
            coalesce((select sum(amount_kobo) from funding_transfers where kind = 'payout_paid'), 0)::text as withdrawn,
            coalesce((select sum(amount_kobo) from funding_transfers where kind = 'bill_paid'), 0)::text as bills_paid,
            (select count(*) from withdrawals w where not exists (select 1 from withdrawal_outcomes o where o.withdrawal_id = w.id))::int as withdrawals_pending,
            (select count(*) from bill_purchases b where not exists (select 1 from bill_outcomes o where o.bill_id = b.id))::int as bills_pending,
            (select count(*) from sponsor_tasks where review_state = 'pending_review')::int as campaigns_to_review,
            (select count(*) from purchase_voids v where exists (select 1 from purchase_void_disputes d where d.confirmation_id = v.confirmation_id)
              and not exists (select 1 from purchase_void_rulings r where r.confirmation_id = v.confirmation_id))::int as disputes_open
        `),
      );
      const series = rows(
        await tx.execute(sql`
          with days as (
            select generate_series((clock_timestamp() at time zone 'Africa/Lagos')::date - 13,
              (clock_timestamp() at time zone 'Africa/Lagos')::date, interval '1 day')::date as day)
          select d.day::text as day,
            (select count(*) from accounts a where (a.created_at at time zone 'Africa/Lagos')::date = d.day)::int as signups,
            (select count(*) from purchase_confirmations p where (p.created_at at time zone 'Africa/Lagos')::date = d.day)::int as purchases
          from days d order by d.day`),
      ).map((x) => ({
        day: String(x.day),
        signups: Number(x.signups),
        purchases: Number(x.purchases),
      }));
      const n = (k: string) => Number(r?.[k] ?? 0);
      const k = (key: string) => String(r?.[key] ?? '0');
      return {
        people: {
          accounts: n('accounts'),
          new7d: n('accounts_7d'),
          new30d: n('accounts_30d'),
          verifiedPhones: n('verified_phones'),
        },
        businesses: {
          total: n('businesses'),
          new30d: n('businesses_30d'),
          liveCampaigns: n('live_campaigns'),
        },
        activity: {
          purchases: n('purchases'),
          purchases7d: n('purchases_7d'),
          prizeClaims: n('prize_claims'),
        },
        money: {
          fundedKobo: k('funded'),
          funded30dKobo: k('funded_30d'),
          lockedKobo: k('locked'),
          paidToUsersKobo: k('paid_to_users'),
          inWalletsKobo: k('in_wallets'),
          withdrawnKobo: k('withdrawn'),
          billsPaidKobo: k('bills_paid'),
        },
        queues: {
          campaignsToReview: n('campaigns_to_review'),
          disputesOpen: n('disputes_open'),
          withdrawalsPending: n('withdrawals_pending'),
          billsPending: n('bills_pending'),
        },
        series,
      };
    });
  }

  // People and businesses by username, name, email or business name.
  async search(user: string, query: unknown) {
    const parsed = searchInput.safeParse(query);
    if (!parsed.success)
      throw new BadRequestException('Type at least 2 characters');
    const term = parsed.data.replace(/^@/, '').toLowerCase();
    const like = `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    return this.reviewer(user, async (tx, actor) => {
      const found = rows(
        await tx.execute(sql`
          select a.id, a.access_state, a.created_at, u.username, p.display_name,
            au.email, sp.name as business_name,
            exists (select 1 from verified_phones v where v.account_id = a.id) as phone_verified
          from accounts a
          left join usernames u on u.account_id = a.id and u.is_current
          left join account_profiles p on p.account_id = a.id
          left join auth_account_links l on l.account_id = a.id
          left join auth_users au on au.id = l.auth_user_id
          left join sponsor_profiles sp on sp.owner_id = a.id
          where u.username like ${like} or lower(p.display_name) like ${like}
            or lower(au.email) like ${like} or lower(sp.name) like ${like}
          order by (u.username = ${term}) desc, (lower(au.email) = ${term}) desc, a.created_at desc
          limit 25`),
      ).map((r) => ({
        id: String(r.id),
        username: r.username == null ? null : String(r.username),
        displayName: r.display_name == null ? null : String(r.display_name),
        email: r.email == null ? null : String(r.email),
        businessName: r.business_name == null ? null : String(r.business_name),
        accessState: String(r.access_state),
        phoneVerified: Boolean(r.phone_verified),
        createdAt: iso(r.created_at),
      }));
      // Searches are recorded like any other look-up.
      await recordAudit(tx, {
        kind: 'admin_search',
        subject: actor,
        actor,
        detail: { results: found.length },
      });
      return { items: found };
    });
  }

  // One account in full: identity, business, money and recent changes.
  async accountDetail(user: string, accountId: string) {
    if (!z.uuid().safeParse(accountId).success) throw new NotFoundException();
    return this.reviewer(user, async (tx, actor) => {
      const view = await this.accountView(tx, accountId);
      await recordAudit(tx, {
        kind: 'admin_account_viewed',
        subject: accountId,
        actor,
      });
      const [money] = rows(
        await tx.execute(sql`
          select
            coalesce((select sum(case when f.destination_id = a.id then f.amount_kobo else -f.amount_kobo end)
              from funding_accounts a join funding_transfers f on f.source_id = a.id or f.destination_id = a.id
              where a.owner_id = ${accountId} and a.bucket = 'reward_wallet'), 0)::text as wallet,
            coalesce((select sum(case when f.destination_id = a.id then f.amount_kobo else -f.amount_kobo end)
              from funding_accounts a join funding_transfers f on f.source_id = a.id or f.destination_id = a.id
              where a.owner_id = ${accountId} and a.bucket = 'available'), 0)::text as business_available,
            coalesce((select sum(case when f.destination_id = a.id then f.amount_kobo else -f.amount_kobo end)
              from funding_accounts a join funding_transfers f on f.source_id = a.id or f.destination_id = a.id
              where a.owner_id = ${accountId} and a.bucket = 'task_locked'), 0)::text as business_locked,
            coalesce((select sum(f.amount_kobo) from funding_transfers f join funding_accounts a on a.id = f.destination_id
              where a.owner_id = ${accountId} and f.kind = 'funding_confirmed'), 0)::text as funded,
            (select count(*) from purchase_confirmations where account_id = ${accountId})::int as purchases,
            (select email from auth_users au join auth_account_links l on l.auth_user_id = au.id
              where l.account_id = ${accountId}) as email,
            (select account_type from auth_users au join auth_account_links l on l.auth_user_id = au.id
              where l.account_id = ${accountId}) as account_type`),
      );
      const business = rows(
        await tx.execute(sql`
          select sp.id, sp.name, sp.terms_accepted_at as created_at,
            (select count(*) from sponsor_tasks t where t.sponsor_id = sp.id)::int as campaigns
          from sponsor_profiles sp where sp.owner_id = ${accountId}`),
      )[0];
      return {
        ...view,
        email: money?.email == null ? null : String(money.email),
        accountType:
          money?.account_type === 'business' ? 'business' : 'personal',
        walletKobo: String(money?.wallet ?? '0'),
        purchases: Number(money?.purchases ?? 0),
        businessProfile: business
          ? {
              id: String(business.id),
              name: String(business.name),
              createdAt: iso(business.created_at),
              campaigns: Number(business.campaigns),
              fundedKobo: String(money?.funded ?? '0'),
              availableKobo: String(money?.business_available ?? '0'),
              lockedKobo: String(money?.business_locked ?? '0'),
            }
          : null,
      };
    });
  }
}
