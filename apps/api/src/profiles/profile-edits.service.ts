import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { displayNameSchema, usernameSchema } from '@pointrush/contracts';
import type { FundingDatabase } from '../funding/funding-ledger.js';
import { AccountsRepository } from '../accounts/accounts.repository.js';
import { handleSchema } from '../sponsors/sponsor.validation.js';
import { actorTransaction } from '../tasks/actor-transaction.js';
import { RatingsService } from '../sponsors/ratings.service.js';

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
const changeInput = z.discriminatedUnion('field', [
  z
    .object({
      id: z.uuid(),
      field: z.literal('name'),
      value: plain(120).pipe(z.string().min(1)),
    })
    .strict(),
  z
    .object({
      id: z.uuid(),
      field: z.literal('contact_email'),
      value: z.email().max(320),
    })
    .strict(),
  z
    .object({
      id: z.uuid(),
      field: z.literal('description'),
      value: plain(500),
    })
    .strict(),
  // A new logo is an uploaded file's ID; an empty value removes the logo.
  z
    .object({
      id: z.uuid(),
      field: z.literal('logo'),
      value: z.union([z.uuid(), z.literal('')]),
    })
    .strict(),
]);
const decisionInput = z
  .object({
    decision: z.enum(['applied', 'rejected']),
    reason: z.string().trim().min(3).max(500),
  })
  .strict();
const adminHandleInput = z
  .object({ handle: handleSchema, reason: z.string().trim().min(3).max(500) })
  .strict();

function parse<T>(schema: z.ZodType<T>, value: unknown, message: string): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new BadRequestException(message);
  return result.data;
}

// Editing who you are, with history: business handles, business details,
// display names and usernames. The database enforces the rules (handle
// grace period, reviews for renamed businesses, 7-day display names); this
// service shapes requests and answers.
export class ProfileEditsService {
  private readonly accounts: AccountsRepository;
  private readonly ratings: RatingsService;
  constructor(private readonly db: FundingDatabase) {
    this.accounts = new AccountsRepository({ db } as never);
    this.ratings = new RatingsService(db);
  }

  // Live check while someone types a handle.
  async checkHandle(user: string, input: unknown) {
    const parsed = handleSchema.safeParse(input);
    if (!parsed.success)
      return { available: false, reason: 'invalid' as const, suggestion: null };
    const handle = parsed.data;
    return actorTransaction(this.db, user, async (tx) => {
      const [r] = rows(
        await tx.execute(sql`
          select handle_taken(${handle}) as taken, handle_reserved(${handle}) as reserved,
            handle_suggest(${handle}) as suggestion`),
      );
      const reason = r?.reserved ? 'reserved' : r?.taken ? 'taken' : null;
      return {
        available: !reason,
        reason,
        suggestion: reason ? text(r?.suggestion) : null,
      };
    });
  }

  private async business(tx: FundingDatabase, actor: string) {
    const [b] = rows(
      await tx.execute(sql`
        select sp.id, sp.name, sp.contact_email, sp.description, sp.terms_accepted_at, sp.logo_file_id,
          (select handle from business_handles h where h.sponsor_id = sp.id order by seq desc limit 1) as handle,
          (select count(*) from business_handles h where h.sponsor_id = sp.id)::int as handles,
          business_has_approved_campaign(sp.id) as approved
        from sponsor_profiles sp where sp.owner_id = ${actor}`),
    );
    if (!b) throw new NotFoundException();
    return b;
  }

  // The owner's view: current details, whether the handle can still change,
  // and every change with its state.
  async mine(user: string) {
    return actorTransaction(this.db, user, async (tx, actor) => {
      const b = await this.business(tx, actor);
      const changes = rows(
        await tx.execute(sql`
          select c.id, c.field, c.old_value, c.new_value, c.needs_review, c.created_at,
            d.decision, d.reason
          from business_profile_changes c
          left join business_profile_decisions d on d.change_id = c.id
          where c.sponsor_id = ${b.id}
          order by c.created_at desc limit 20`),
      ).map((c) => ({
        id: String(c.id),
        field: String(c.field),
        oldValue: text(c.old_value),
        newValue: text(c.new_value),
        state: !c.needs_review
          ? 'applied'
          : c.decision == null
            ? 'pending'
            : String(c.decision),
        note: text(c.reason),
        at: iso(c.created_at),
      }));
      const handles = rows(
        await tx.execute(sql`
          select handle, created_at from business_handles where sponsor_id = ${b.id} order by seq desc`),
      ).map((h) => ({ handle: String(h.handle), at: iso(h.created_at) }));
      return {
        id: String(b.id),
        name: String(b.name),
        contactEmail: String(b.contact_email),
        description: text(b.description),
        logoFileId: text(b.logo_file_id),
        handle: text(b.handle),
        since: iso(b.terms_accepted_at),
        // One change, until the first campaign is approved.
        canChangeHandle: Number(b.handles) <= 1 && !b.approved,
        nameNeedsReview: Boolean(b.approved),
        handles,
        changes,
      };
    });
  }

  async changeHandle(user: string, input: unknown) {
    const { handle } = parse(
      z.object({ handle: handleSchema }).strict(),
      input,
      'Use 3–30 lowercase letters, numbers or single underscores, starting with a letter',
    );
    return actorTransaction(this.db, user, async (tx, actor) => {
      const b = await this.business(tx, actor);
      if (b.handle === handle) return { handle };
      await tx.execute(sql`
        insert into business_handles (handle, sponsor_id, actor_id) values (${handle}, ${b.id}, ${actor})`);
      return { handle };
    });
  }

  // Name, contact email or description. Applied at once, except a name
  // change after an approved campaign, which waits for a reviewer.
  async change(user: string, input: unknown) {
    const value = parse(changeInput, input, 'Check the new value');
    return actorTransaction(this.db, user, async (tx, actor) => {
      const b = await this.business(tx, actor);
      const [existing] = rows(
        await tx.execute(
          sql`select id, needs_review, new_value from business_profile_changes where id = ${value.id}`,
        ),
      );
      if (existing) {
        if (existing.new_value !== (value.value || null))
          throw new BadRequestException('Change ID already used');
        return { state: existing.needs_review ? 'pending' : 'applied' };
      }
      const current =
        value.field === 'name'
          ? b.name
          : value.field === 'contact_email'
            ? b.contact_email
            : value.field === 'logo'
              ? b.logo_file_id
              : b.description;
      const next = value.value === '' ? null : value.value;
      const [row] = rows(
        await tx.execute(sql`
          insert into business_profile_changes (id, sponsor_id, field, old_value, new_value, actor_id)
          values (${value.id}, ${b.id}, ${value.field}, ${current == null ? null : String(current)}, ${next}, ${actor})
          returning needs_review`),
      );
      if (row?.needs_review) return { state: 'pending' as const };
      await this.apply(tx, value.id, b.id as string, value.field, next);
      return { state: 'applied' as const };
    });
  }

  private async apply(
    tx: FundingDatabase,
    changeId: string,
    sponsorId: string,
    field: 'name' | 'contact_email' | 'description' | 'logo',
    value: string | null,
  ) {
    await tx.execute(
      sql`select set_config('acticlaim.profile_change', ${changeId}, true)`,
    );
    if (field === 'name')
      await tx.execute(
        sql`update sponsor_profiles set name = ${value} where id = ${sponsorId}`,
      );
    else if (field === 'logo')
      await tx.execute(
        sql`update sponsor_profiles set logo_file_id = ${value}::uuid where id = ${sponsorId}`,
      );
    else if (field === 'contact_email')
      await tx.execute(
        sql`update sponsor_profiles set contact_email = ${value} where id = ${sponsorId}`,
      );
    else
      await tx.execute(
        sql`update sponsor_profiles set description = ${value} where id = ${sponsorId}`,
      );
    await tx.execute(
      sql`select set_config('acticlaim.profile_change', '', true)`,
    );
  }

  async changeDisplayName(user: string, input: unknown) {
    const parsed = displayNameSchema.safeParse(
      (input as { displayName?: unknown } | null)?.displayName,
    );
    if (!parsed.success)
      throw new BadRequestException('Use a visible name of 1–80 characters');
    const displayName = parsed.data;
    return actorTransaction(this.db, user, async (tx, actor) => {
      const [current] = rows(
        await tx.execute(
          sql`select display_name from account_profiles where account_id = ${actor}`,
        ),
      );
      if (!current) throw new NotFoundException();
      if (current.display_name === displayName) return { displayName };
      const id = randomUUID();
      await tx.execute(sql`
        insert into display_name_changes (id, account_id, old_value, new_value)
        values (${id}, ${actor}, ${String(current.display_name)}, ${displayName})`);
      await tx.execute(
        sql`select set_config('acticlaim.display_name_change', ${id}, true)`,
      );
      await tx.execute(
        sql`update account_profiles set display_name = ${displayName} where account_id = ${actor}`,
      );
      return { displayName };
    });
  }

  // Usernames change at most every 30 days; old ones stay reserved.
  async changeUsername(user: string, input: unknown) {
    const parsed = usernameSchema.safeParse(
      (input as { username?: unknown } | null)?.username,
    );
    if (!parsed.success)
      throw new BadRequestException({
        statusCode: 400,
        message: 'Follow the username rules',
      });
    const actor = await actorTransaction(this.db, user, (_tx, id) =>
      Promise.resolve(id),
    );
    return this.accounts.rename(actor, parsed.data);
  }

  // The public business page. An old handle answers with the current one,
  // so links keep working. Recent names are shown so a rename cannot hide
  // a business's history.
  async publicBusiness(input: string) {
    const parsed = handleSchema.safeParse(input);
    if (!parsed.success) throw new NotFoundException();
    const [b] = rows(
      await this.db.execute(sql`
        select sp.id, sp.name, sp.description, sp.terms_accepted_at, sp.logo_file_id,
          (select handle from business_handles h2 where h2.sponsor_id = sp.id order by seq desc limit 1) as current
        from business_handles h
        join sponsor_profiles sp on sp.id = h.sponsor_id
        join accounts a on a.id = sp.owner_id and a.access_state = 'active'
        where h.handle = ${parsed.data}`),
    );
    if (!b) throw new NotFoundException();
    if (b.current !== parsed.data) return { redirect: String(b.current) };
    const formerly = rows(
      await this.db.execute(sql`
        select c.old_value, c.created_at from business_profile_changes c
        left join business_profile_decisions d on d.change_id = c.id
        where c.sponsor_id = ${b.id} and c.field = 'name'
          and (not c.needs_review or d.decision = 'applied')
          and c.created_at > clock_timestamp() - interval '90 days'
        order by c.created_at desc`),
    ).map((r) => ({ name: String(r.old_value), until: iso(r.created_at) }));
    const offers = rows(
      await this.db.execute(sql`
        select t.id, t.title, t.model, t.reward_kobo::text as reward, t.ends_at
        from sponsor_tasks t
        where t.sponsor_id = ${b.id} and t.model in ('purchase_cashback', 'claim_code')
          and exists (select 1 from task_publications p where p.task_id = t.id)
          and t.ends_at > clock_timestamp()
        order by t.ends_at limit 20`),
    ).map((r) => ({
      id: String(r.id),
      title: String(r.title),
      model: String(r.model),
      rewardKobo: String(r.reward),
      endsAt: iso(r.ends_at),
    }));
    return {
      handle: String(b.current),
      name: String(b.name),
      description: text(b.description),
      logoFileId: text(b.logo_file_id),
      since: iso(b.terms_accepted_at),
      formerly,
      offers,
      ratings: await this.ratings.summary(this.db, String(b.id)),
    };
  }

  // Reviewer side: renames waiting for a decision.
  async pending(tx: FundingDatabase) {
    return rows(
      await tx.execute(sql`
        select c.id, c.sponsor_id, c.field, c.old_value, c.new_value, c.created_at,
          (select handle from business_handles h where h.sponsor_id = c.sponsor_id order by seq desc limit 1) as handle
        from business_profile_changes c
        where c.needs_review and not exists (select 1 from business_profile_decisions d where d.change_id = c.id)
        order by c.created_at limit 50`),
    ).map((c) => ({
      id: String(c.id),
      sponsorId: String(c.sponsor_id),
      handle: text(c.handle),
      field: String(c.field),
      oldValue: text(c.old_value),
      newValue: text(c.new_value),
      at: iso(c.created_at),
    }));
  }

  async decide(
    tx: FundingDatabase,
    actor: string,
    changeId: string,
    input: unknown,
  ) {
    if (!z.uuid().safeParse(changeId).success) throw new NotFoundException();
    const value = parse(
      decisionInput,
      input,
      'Choose a decision and give a reason',
    );
    const [change] = rows(
      await tx.execute(
        sql`select sponsor_id, field, new_value from business_profile_changes where id = ${changeId}`,
      ),
    );
    if (!change) throw new NotFoundException();
    await tx.execute(sql`
      insert into business_profile_decisions (change_id, decision, reviewer_id, reason)
      values (${changeId}, ${value.decision}, ${actor}, ${value.reason})`);
    if (value.decision === 'applied')
      await this.apply(
        tx,
        changeId,
        String(change.sponsor_id),
        change.field as 'name' | 'logo',
        text(change.new_value),
      );
    return { decision: value.decision };
  }

  // A reviewer changing a locked handle, for impersonation or a legal
  // complaint. The old handle stays reserved and redirects.
  async setHandleAsReviewer(
    tx: FundingDatabase,
    actor: string,
    sponsorId: string,
    input: unknown,
  ) {
    if (!z.uuid().safeParse(sponsorId).success) throw new NotFoundException();
    const value = parse(
      adminHandleInput,
      input,
      'Give a valid handle and a reason',
    );
    const [owner] = rows(
      await tx.execute(
        sql`select owner_id from sponsor_profiles where id = ${sponsorId}`,
      ),
    );
    if (!owner) throw new NotFoundException();
    if (owner.owner_id === actor)
      throw new ForbiddenException('Another reviewer must change your handle');
    await tx.execute(sql`
      insert into business_handles (handle, sponsor_id, actor_id, reason)
      values (${value.handle}, ${sponsorId}, ${actor}, ${value.reason})`);
    return { handle: value.handle };
  }
}
