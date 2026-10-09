import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import type { FundingDatabase } from '../funding/funding-ledger.js';
import { actorTransaction } from '../tasks/actor-transaction.js';
import { handleSchema } from './sponsor.validation.js';

type Row = Record<string, unknown>;
const rows = (result: unknown) =>
  ((result as { rows?: Row[] }).rows ?? (result as Row[])) as Row[];
const iso = (value: unknown) => new Date(String(value)).toISOString();
const text = (value: unknown) => (value == null ? null : String(value));

const plain = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .refine((v) => !/[\p{Cc}\p{Cs}‪-‮⁦-⁩]/u.test(v));
const rateInput = z
  .object({
    stars: z.number().int().min(1).max(5),
    comment: plain(500).optional(),
  })
  .strict();
const replyInput = z
  .object({ body: plain(500).pipe(z.string().min(1)) })
  .strict();
const removalInput = z
  .object({ reason: z.string().trim().min(3).max(500) })
  .strict();

function parse<T>(schema: z.ZodType<T>, value: unknown, message: string): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new BadRequestException(message);
  return result.data;
}

// What a reader sees of a rating: first name only, the stars, the words,
// the name the business had then, and the business's reply.
function shape(r: Row) {
  return {
    id: String(r.id),
    stars: Number(r.stars),
    comment: text(r.comment),
    by: String(r.display_name ?? 'Customer').split(/\s+/)[0]!,
    businessNameThen: String(r.business_name),
    at: iso(r.created_at),
    edited: r.edited_at != null,
    reply:
      r.reply_body == null
        ? null
        : { body: String(r.reply_body), at: iso(r.reply_at) },
  };
}

const listSql = (where: ReturnType<typeof sql>, limit: number) => sql`
  select r.id, r.stars, r.comment, r.business_name, r.created_at, r.edited_at,
    p.display_name, rp.body as reply_body, rp.created_at as reply_at,
    exists (select 1 from business_rating_removals x where x.rating_id = r.id) as removed,
    (select x.reason from business_rating_removals x where x.rating_id = r.id) as removed_reason,
    sp.name as business_now, u.username
  from business_ratings r
  join sponsor_profiles sp on sp.id = r.sponsor_id
  left join account_profiles p on p.account_id = r.account_id
  left join usernames u on u.account_id = r.account_id and u.is_current
  left join business_rating_replies rp on rp.rating_id = r.id
  where ${where}
  order by r.created_at desc limit ${limit}`;

// Ratings from verified customers only. The database decides who may rate
// (served by the business, verified phone, not owner or staff) and keeps
// each rating's history fixed after 48 hours.
export class RatingsService {
  constructor(private readonly db: FundingDatabase) {}

  private async sponsorByHandle(tx: FundingDatabase, input: string) {
    const parsed = handleSchema.safeParse(input);
    if (!parsed.success) throw new NotFoundException();
    const [b] = rows(
      await tx.execute(
        sql`select sponsor_id from business_handles where handle = ${parsed.data}`,
      ),
    );
    if (!b) throw new NotFoundException();
    return String(b.sponsor_id);
  }

  // Average, count, spread and the latest ratings for a business page.
  async summary(tx: FundingDatabase, sponsorId: string) {
    const [totals] = rows(
      await tx.execute(sql`
        select count(*)::int as count, round(avg(stars)::numeric, 1)::text as average,
          count(*) filter (where stars = 5)::int as s5, count(*) filter (where stars = 4)::int as s4,
          count(*) filter (where stars = 3)::int as s3, count(*) filter (where stars = 2)::int as s2,
          count(*) filter (where stars = 1)::int as s1
        from business_ratings r
        where r.sponsor_id = ${sponsorId}
          and not exists (select 1 from business_rating_removals x where x.rating_id = r.id)`),
    );
    const recent = rows(
      await tx.execute(
        listSql(
          sql`r.sponsor_id = ${sponsorId} and not exists (select 1 from business_rating_removals x where x.rating_id = r.id)`,
          10,
        ),
      ),
    ).map(shape);
    const count = Number(totals?.count ?? 0);
    return {
      count,
      average: count ? Number(totals?.average) : null,
      stars: [5, 4, 3, 2, 1].map((n) => ({
        stars: n,
        count: Number(totals?.[`s${n}`] ?? 0),
      })),
      recent,
    };
  }

  // Whether you can rate this business, and your rating if you did.
  async mine(user: string, handle: string) {
    return actorTransaction(this.db, user, async (tx, actor) => {
      const sponsorId = await this.sponsorByHandle(tx, handle);
      const [r] = rows(
        await tx.execute(sql`
          select r.id, r.stars, r.comment, r.created_at,
            exists (select 1 from business_rating_removals x where x.rating_id = r.id) as removed,
            r.created_at + interval '48 hours' > clock_timestamp() as editable
          from business_ratings r where r.sponsor_id = ${sponsorId} and r.account_id = ${actor}`),
      );
      const [e] = rows(
        await tx.execute(sql`
          select business_served(${sponsorId}, ${actor}) as served,
            exists (select 1 from verified_phones where account_id = ${actor}) as phone,
            exists (select 1 from sponsor_profiles where id = ${sponsorId} and owner_id = ${actor}) as owner`),
      );
      const editableUntil = r
        ? new Date(Date.parse(iso(r.created_at)) + 48 * 3600000).toISOString()
        : null;
      return {
        canRate: Boolean(e?.served && e.phone && !e.owner),
        needsPhone: Boolean(e?.served && !e.phone),
        rating: r
          ? {
              id: String(r.id),
              stars: Number(r.stars),
              comment: text(r.comment),
              removed: Boolean(r.removed),
              editableUntil,
              canEdit: Boolean(r.editable) && !r.removed,
            }
          : null,
      };
    });
  }

  async rate(user: string, handle: string, input: unknown) {
    const value = parse(rateInput, input, 'Choose 1 to 5 stars');
    const comment = value.comment ? value.comment : null;
    return actorTransaction(this.db, user, async (tx, actor) => {
      const sponsorId = await this.sponsorByHandle(tx, handle);
      const [existing] = rows(
        await tx.execute(
          sql`select id from business_ratings where sponsor_id = ${sponsorId} and account_id = ${actor}`,
        ),
      );
      if (existing)
        await tx.execute(sql`
          update business_ratings set stars = ${value.stars}, comment = ${comment}
          where id = ${String(existing.id)}`);
      else
        await tx.execute(sql`
          insert into business_ratings (id, sponsor_id, account_id, stars, comment, business_name)
          values (${randomUUID()}, ${sponsorId}, ${actor}, ${value.stars}, ${comment}, '')`);
      return { stars: value.stars, comment };
    });
  }

  // The owner's view: every rating, including removed ones and why.
  async forBusiness(user: string) {
    return actorTransaction(this.db, user, async (tx, actor) => {
      const [b] = rows(
        await tx.execute(
          sql`select id from sponsor_profiles where owner_id = ${actor}`,
        ),
      );
      if (!b) throw new NotFoundException();
      const items = rows(
        await tx.execute(listSql(sql`r.sponsor_id = ${String(b.id)}`, 100)),
      ).map((r) => ({
        ...shape(r),
        removed: Boolean(r.removed),
        removedReason: text(r.removed_reason),
      }));
      return { summary: await this.summary(tx, String(b.id)), items };
    });
  }

  async reply(user: string, ratingId: string, input: unknown) {
    if (!z.uuid().safeParse(ratingId).success) throw new NotFoundException();
    const value = parse(
      replyInput,
      input,
      'Write a reply of up to 500 characters',
    );
    return actorTransaction(this.db, user, async (tx, actor) => {
      // Only the business that was rated may answer.
      const [own] = rows(
        await tx.execute(sql`
          select 1 from business_ratings r join sponsor_profiles sp on sp.id = r.sponsor_id
          where r.id = ${ratingId} and sp.owner_id = ${actor}`),
      );
      if (!own)
        throw new ConflictException({
          statusCode: 409,
          message: 'Reply unavailable',
          reason: 'reply_unavailable',
        });
      const [existing] = rows(
        await tx.execute(
          sql`select 1 from business_rating_replies where rating_id = ${ratingId}`,
        ),
      );
      // One reply per rating, never edited, so it cannot be rewritten later.
      if (existing)
        throw new ConflictException({
          statusCode: 409,
          message: 'You already replied to this rating',
          reason: 'already_replied',
        });
      await tx.execute(sql`
        insert into business_rating_replies (rating_id, actor_id, body)
        values (${ratingId}, ${actor}, ${value.body})`);
      return { body: value.body };
    });
  }

  // Reviewers: latest ratings across businesses, and removal with a reason.
  async recent(tx: FundingDatabase) {
    return rows(await tx.execute(listSql(sql`true`, 50))).map((r) => ({
      ...shape(r),
      businessNow: String(r.business_now),
      username: text(r.username),
      removed: Boolean(r.removed),
      removedReason: text(r.removed_reason),
    }));
  }

  async remove(
    tx: FundingDatabase,
    actor: string,
    ratingId: string,
    input: unknown,
  ) {
    if (!z.uuid().safeParse(ratingId).success) throw new NotFoundException();
    const value = parse(removalInput, input, 'Give a reason');
    const [r] = rows(
      await tx.execute(
        sql`select id from business_ratings where id = ${ratingId}`,
      ),
    );
    if (!r) throw new NotFoundException();
    await tx.execute(sql`
      insert into business_rating_removals (rating_id, reviewer_id, reason)
      values (${ratingId}, ${actor}, ${value.reason})`);
    return { removed: true };
  }
}
