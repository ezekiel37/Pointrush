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

      const [money] = rows(
        await tx.execute(sql`
          with owned as (${owned})
          select
            coalesce((select sum(case when f.destination_id = o.allocation_account_id then f.amount_kobo else -f.amount_kobo end)
              from owned o join funding_transfers f on f.source_id = o.allocation_account_id or f.destination_id = o.allocation_account_id), 0)::text as locked,
            coalesce((select sum(f.amount_kobo) from owned o join funding_transfers f on f.source_id = o.allocation_account_id
              where f.kind in ('purchase_cashback', 'prize_claim', 'task_reward')), 0)::text as paid_out`),
      );

      const campaigns = rows(
        await tx.execute(sql`
          with owned as (${owned})
          select o.id, o.title, o.model, o.capacity, o.review_state, o.lifecycle,
            o.ends_at, o.reward_kobo::text as reward_kobo,
            case
              when o.model = 'purchase_cashback' then (select count(*) from purchase_confirmations p
                where p.task_id = o.id and not exists (select 1 from purchase_voids v where v.confirmation_id = p.id))
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
