import { BadRequestException, NotFoundException } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import * as s from '../database/schema.js';
import type { FundingDatabase } from '../funding/funding-ledger.js';
import { actorTransaction } from '../tasks/actor-transaction.js';

type Row = Record<string, unknown>;
const rows = (result: unknown) =>
  ((result as { rows?: Row[] }).rows ?? (result as Row[])) as Row[];
const addInput = z
  .object({
    id: z.uuid(),
    username: z
      .string()
      .trim()
      .transform((v) => v.replace(/^@/, '').toLowerCase())
      .pipe(z.string().regex(/^[a-z0-9_]{3,20}$/)),
  })
  .strict();

export class StaffService {
  constructor(private readonly db: FundingDatabase) {}

  private async business(tx: FundingDatabase, owner: string) {
    const [business] = await tx
      .select()
      .from(s.sponsorProfiles)
      .where(eq(s.sponsorProfiles.ownerId, owner));
    if (!business) throw new NotFoundException();
    return business;
  }

  private async staffRows(tx: FundingDatabase, sponsorId: string) {
    return rows(
      await tx.execute(sql`
        select s.id, s.created_at, u.username, p.display_name,
          exists (select 1 from business_staff_acceptances a where a.staff_id = s.id) as accepted,
          (select count(*)::int from purchase_confirmations c join sponsor_tasks t on t.id = c.task_id
            where t.sponsor_id = s.sponsor_id and c.actor_id = s.account_id
              and c.created_at > clock_timestamp() - interval '24 hours') as today,
          (select count(*)::int from purchase_confirmations c join sponsor_tasks t on t.id = c.task_id
            where t.sponsor_id = s.sponsor_id and c.actor_id = s.account_id
              and c.created_at > clock_timestamp() - interval '7 days') as week,
          (select coalesce(sum(t.reward_kobo), 0)::text from purchase_confirmations c join sponsor_tasks t on t.id = c.task_id
            where t.sponsor_id = s.sponsor_id and c.actor_id = s.account_id
              and c.created_at > clock_timestamp() - interval '7 days') as week_cashback,
          -- Shoppers this person confirmed three or more times in a week.
          (select count(*)::int from (select c.account_id from purchase_confirmations c
            join sponsor_tasks t on t.id = c.task_id
            where t.sponsor_id = s.sponsor_id and c.actor_id = s.account_id
              and c.created_at > clock_timestamp() - interval '7 days'
            group by c.account_id having count(*) >= 3) repeat) as repeat_shoppers
        from business_staff s
        left join usernames u on u.account_id = s.account_id and u.is_current
        left join account_profiles p on p.account_id = s.account_id
        where s.sponsor_id = ${sponsorId}
          and not exists (select 1 from business_staff_removals r where r.staff_id = s.id)
        order by s.created_at`),
    ).map((r) => ({
      id: String(r.id),
      username: r.username == null ? null : String(r.username),
      displayName: r.display_name == null ? null : String(r.display_name),
      addedAt: new Date(String(r.created_at)).toISOString(),
      accepted: Boolean(r.accepted),
      confirmedToday: Number(r.today ?? 0),
      confirmedWeek: Number(r.week ?? 0),
      weekCashbackKobo: String(r.week_cashback ?? '0'),
      repeatShoppers: Number(r.repeat_shoppers ?? 0),
    }));
  }

  async list(user: string) {
    return actorTransaction(this.db, user, async (tx, actor) => {
      const business = await this.business(tx, actor);
      return { items: await this.staffRows(tx, business.id) };
    });
  }

  async add(user: string, input: unknown) {
    const parsed = addInput.safeParse(input);
    if (!parsed.success) throw new BadRequestException('Enter a username');
    const { id, username } = parsed.data;
    return actorTransaction(this.db, user, async (tx, actor) => {
      const business = await this.business(tx, actor);
      const [existing] = await tx
        .select()
        .from(s.businessStaff)
        .where(eq(s.businessStaff.id, id));
      if (!existing) {
        const [person] = await tx
          .select({ accountId: s.usernames.accountId })
          .from(s.usernames)
          .where(
            and(
              eq(s.usernames.username, username),
              eq(s.usernames.isCurrent, true),
            ),
          );
        // Unknown usernames and ineligible people share one answer.
        if (!person?.accountId) throw new NotFoundException();
        await tx.insert(s.businessStaff).values({
          id,
          sponsorId: business.id,
          accountId: person.accountId,
          addedBy: actor,
        });
      } else if (existing.sponsorId !== business.id)
        throw new NotFoundException();
      return { items: await this.staffRows(tx, business.id) };
    });
  }

  async remove(user: string, staffId: string) {
    if (!z.uuid().safeParse(staffId).success) throw new NotFoundException();
    return actorTransaction(this.db, user, async (tx, actor) => {
      const business = await this.business(tx, actor);
      const [member] = await tx
        .select()
        .from(s.businessStaff)
        .where(
          and(
            eq(s.businessStaff.id, staffId),
            eq(s.businessStaff.sponsorId, business.id),
          ),
        );
      if (!member) throw new NotFoundException();
      await tx
        .insert(s.businessStaffRemovals)
        .values({ staffId, removedBy: actor })
        .onConflictDoNothing();
      return { items: await this.staffRows(tx, business.id) };
    });
  }

  // The invited person accepts; until then they have no till access.
  async accept(user: string, staffId: string) {
    if (!z.uuid().safeParse(staffId).success) throw new NotFoundException();
    await actorTransaction(this.db, user, async (tx, actor) => {
      const [invite] = await tx
        .select()
        .from(s.businessStaff)
        .where(
          and(
            eq(s.businessStaff.id, staffId),
            eq(s.businessStaff.accountId, actor),
          ),
        );
      if (!invite) throw new NotFoundException();
      await tx
        .insert(s.businessStaffAcceptances)
        .values({ staffId })
        .onConflictDoNothing();
    });
    return this.workplaces(user);
  }

  // Businesses this person works at, with the cash back tills they can run.
  async workplaces(user: string) {
    return actorTransaction(this.db, user, async (tx, actor) => {
      const found = rows(
        await tx.execute(sql`
          select sp.id as business_id, sp.name, t.id as task_id, t.title, t.ends_at
          from business_staff s
          join sponsor_profiles sp on sp.id = s.sponsor_id
          left join sponsor_tasks t on t.sponsor_id = sp.id and t.model = 'purchase_cashback'
            and t.lifecycle = 'published' and t.ends_at > clock_timestamp()
          where s.account_id = ${actor}
            and exists (select 1 from business_staff_acceptances a where a.staff_id = s.id)
            and not exists (select 1 from business_staff_removals r where r.staff_id = s.id)
          order by sp.name, t.ends_at`),
      );
      const prizes = rows(
        await tx.execute(sql`
          select t.sponsor_id, t.id, t.title, t.promotion_terms->'prize'->>'item' as item
          from business_staff s
          join sponsor_tasks t on t.sponsor_id = s.sponsor_id
          where s.account_id = ${actor}
            and exists (select 1 from business_staff_acceptances a where a.staff_id = s.id)
            and not exists (select 1 from business_staff_removals r where r.staff_id = s.id)
            and t.model = 'claim_code' and t.lifecycle = 'published'
            and jsonb_typeof(t.promotion_terms->'prize') = 'object'
            and t.ends_at > clock_timestamp() - interval '30 days'
          order by t.ends_at`),
      );
      const businesses = new Map<
        string,
        {
          id: string;
          name: string;
          tills: { id: string; title: string }[];
          prizes: { id: string; title: string; item: string }[];
        }
      >();
      for (const r of found) {
        const id = String(r.business_id);
        const entry = businesses.get(id) ?? {
          id,
          name: String(r.name),
          tills: [],
          prizes: [],
        };
        if (r.task_id != null)
          entry.tills.push({ id: String(r.task_id), title: String(r.title) });
        businesses.set(id, entry);
      }
      for (const p of prizes)
        businesses.get(String(p.sponsor_id))?.prizes.push({
          id: String(p.id),
          title: String(p.title),
          item: String(p.item),
        });
      const invitations = rows(
        await tx.execute(sql`
          select s.id, sp.name from business_staff s
          join sponsor_profiles sp on sp.id = s.sponsor_id
          where s.account_id = ${actor}
            and not exists (select 1 from business_staff_acceptances a where a.staff_id = s.id)
            and not exists (select 1 from business_staff_removals r where r.staff_id = s.id)
          order by s.created_at`),
      ).map((r) => ({ id: String(r.id), business: String(r.name) }));
      return { items: [...businesses.values()], invitations };
    });
  }
}
