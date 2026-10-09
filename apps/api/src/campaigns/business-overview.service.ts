import { BadRequestException, NotFoundException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import type { FundingDatabase } from '../funding/funding-ledger.js';
import { actorTransaction } from '../tasks/actor-transaction.js';

const overviewInput = z
  .object({ days: z.enum(['7', '30']).default('7').transform(Number) })
  .strict();

type Row = Record<string, unknown>;
const rows = (result: unknown) =>
  ((result as { rows?: Row[] }).rows ?? (result as Row[])) as Row[];
const int = (value: unknown) => Number(value ?? 0);
const kobo = (value: unknown) => String(value ?? '0');

// A business's dashboard, derived only from its own ledger and settled records.
// Days are calendar days in Lagos time.
export class BusinessOverviewService {
  constructor(private readonly db: FundingDatabase) {}

  async overview(user: string, input: unknown = {}) {
    const parsed = overviewInput.safeParse(input);
    if (!parsed.success)
      throw new BadRequestException('Invalid overview range');
    const { days } = parsed.data;
    return actorTransaction(this.db, user, async (tx, actor) => {
      const owned = sql`select t.* from sponsor_tasks t join sponsor_profiles sp on sp.id = t.sponsor_id where sp.owner_id = ${actor}`;
      const [business] = rows(
        await tx.execute(
          sql`select id, name from sponsor_profiles where owner_id = ${actor}`,
        ),
      );
      if (!business) throw new NotFoundException();

      const series = rows(
        await tx.execute(sql`
          with owned as (${owned}),
          today as (select (clock_timestamp() at time zone 'Africa/Lagos')::date as day),
          days as (
            select generate_series((select day from today) - ${days - 1}::int, (select day from today), interval '1 day')::date as day
          )
          select d.day::text as day,
            (select count(*) from purchase_confirmations p join owned o on o.id = p.task_id
              where (p.created_at at time zone 'Africa/Lagos')::date = d.day)::int as purchases,
            (select count(*) from claim_redemptions r join owned o on o.id = r.task_id
              where (r.created_at at time zone 'Africa/Lagos')::date = d.day)::int as claims
          from days d order by d.day`),
      ).map((r) => ({
        day: String(r.day),
        purchases: int(r.purchases),
        claims: int(r.claims),
      }));

      const [states] = rows(
        await tx.execute(sql`
          with owned as (${owned})
          select
            count(*) filter (where v.confirmation_id is null and r.confirmation_id is null and p.release_at > clock_timestamp())::int as held,
            count(*) filter (where v.confirmation_id is null and r.confirmation_id is null and p.release_at <= clock_timestamp())::int as ready,
            count(r.confirmation_id)::int as paid,
            count(v.confirmation_id)::int as voided,
            (select count(*)::int from (select p2.account_id from purchase_confirmations p2 join owned o2 on o2.id = p2.task_id
              group by p2.account_id having count(*) > 1) repeat) as returning
          from purchase_confirmations p join owned o on o.id = p.task_id
          left join purchase_voids v on v.confirmation_id = p.id
          left join purchase_releases r on r.confirmation_id = p.id`),
      );

      // Loyalty from confirmed purchases (a void counts only if a reviewer
      // reversed it), in Lagos calendar months. Counts only: the business
      // never sees who its customers are.
      const [loyalty] = rows(
        await tx.execute(sql`
          with owned as (${owned}),
          now as (select date_trunc('month', clock_timestamp() at time zone 'Africa/Lagos') as m, clock_timestamp() as ts),
          counted as (
            select p.account_id, p.created_at,
              date_trunc('month', p.created_at at time zone 'Africa/Lagos') as m
            from purchase_confirmations p join owned o on o.id = p.task_id
            where not exists (select 1 from purchase_voids v where v.confirmation_id = p.id)
              or exists (select 1 from purchase_void_rulings r where r.confirmation_id = p.id and r.decision = 'reversed')
          ),
          per as (
            select c.account_id, min(c.m) as first_m, max(c.created_at) as last_at, count(*) as purchases,
              bool_or(c.m = n.m) as this_m,
              bool_or(c.m = n.m - interval '1 month') as m1,
              bool_or(c.m = n.m - interval '2 months') as m2
            from counted c cross join now n group by c.account_id
          )
          select
            count(*)::int as total,
            count(*) filter (where p.this_m)::int as this_month,
            count(*) filter (where p.first_m = n.m)::int as new,
            count(*) filter (where p.this_m and p.first_m < n.m)::int as returning,
            count(*) filter (where p.this_m and p.m1 and p.m2)::int as regular,
            count(*) filter (where p.first_m <= n.m - interval '6 months' and (p.this_m or p.m1))::int as long_term,
            count(*) filter (where p.purchases >= 2 and p.last_at < n.ts - interval '30 days'
              and p.last_at >= n.ts - interval '90 days')::int as slipping
          from per p cross join now n`),
      );

      const [money] = rows(
        await tx.execute(sql`
          with owned as (${owned})
          select
            coalesce((select sum(case when f.destination_id = a.id then f.amount_kobo else -f.amount_kobo end)
              from funding_accounts a join funding_transfers f on f.source_id = a.id or f.destination_id = a.id
              where a.owner_id = ${actor} and a.bucket = 'available'), 0)::text as available,
            coalesce((select sum(case when f.destination_id = o.allocation_account_id then f.amount_kobo else -f.amount_kobo end)
              from owned o join funding_transfers f on f.source_id = o.allocation_account_id or f.destination_id = o.allocation_account_id), 0)::text as locked,
            coalesce((select sum(f.amount_kobo) from owned o join funding_transfers f on f.source_id = o.allocation_account_id
              where f.kind in ('purchase_cashback', 'prize_claim', 'task_reward', 'void_reversal')), 0)::text as paid_out`),
      );

      const campaigns = rows(
        await tx.execute(sql`
          with owned as (${owned})
          select o.id, o.title, o.model, o.capacity, o.review_state, o.lifecycle,
            o.ends_at, o.reward_kobo::text as reward_kobo,
            case when o.review_state in ('changes_required', 'rejected') then
              (select r.reason from task_reviews r where r.task_id = o.id
                order by r.created_at desc limit 1)
            end as review_note,
            exists (select 1 from task_publications p where p.task_id = o.id) as published,
            exists (select 1 from campaign_returns c where c.task_id = o.id) as returned,
            (select coalesce(sum(case when f.destination_id = o.allocation_account_id then f.amount_kobo else -f.amount_kobo end), 0)
              from funding_transfers f where f.source_id = o.allocation_account_id or f.destination_id = o.allocation_account_id)::text as balance_kobo,
            case
              when o.model = 'purchase_cashback' then (select count(*) from purchase_confirmations p
                where p.task_id = o.id and purchase_holds_place(p.id))
              when o.model = 'claim_code' then (select count(*) from claim_redemptions r where r.task_id = o.id)
              else (select count(*) from task_claims c where c.task_id = o.id)
            end::int as used
          from owned o order by o.ends_at desc, o.id limit 50`),
      ).map((r) => ({
        id: String(r.id),
        title: String(r.title),
        model: String(r.model),
        capacity: int(r.capacity),
        used: int(r.used),
        reviewState: String(r.review_state),
        lifecycle: String(r.lifecycle),
        endsAt: new Date(String(r.ends_at)).toISOString(),
        rewardKobo: kobo(r.reward_kobo),
        reviewNote: r.review_note == null ? null : String(r.review_note),
        published: Boolean(r.published),
        cancelled: Boolean(r.returned) && !r.published,
        balanceKobo: kobo(r.balance_kobo),
      }));

      return {
        business: { id: String(business.id), name: String(business.name) },
        days,
        series,
        purchases: {
          held: int(states?.held),
          ready: int(states?.ready),
          paid: int(states?.paid),
          voided: int(states?.voided),
          returningShoppers: int(states?.returning),
        },
        // New: first purchase this month. Returning: back this month after an
        // earlier month. Regular: each of the last 3 months. Long-term: first
        // came 6+ months ago and seen this or last month. Slipping away:
        // bought at least twice, nothing in 30 days (up to 90).
        customers: {
          total: int(loyalty?.total),
          thisMonth: int(loyalty?.this_month),
          new: int(loyalty?.new),
          returning: int(loyalty?.returning),
          regular: int(loyalty?.regular),
          longTerm: int(loyalty?.long_term),
          slippingAway: int(loyalty?.slipping),
        },
        availableKobo: kobo(money?.available),
        lockedKobo: kobo(money?.locked),
        paidOutKobo: kobo(money?.paid_out),
        live: campaigns.filter(
          (c) =>
            c.lifecycle === 'published' && Date.parse(c.endsAt) > Date.now(),
        ).length,
        campaigns,
      };
    });
  }
}
