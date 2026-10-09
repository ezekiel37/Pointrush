import { sql } from 'drizzle-orm';
import type { FundingDatabase } from '../funding/funding-ledger.js';
import { actorTransaction } from '../tasks/actor-transaction.js';

type Row = Record<string, unknown>;
const rows = (result: unknown) =>
  ((result as { rows?: Row[] }).rows ?? (result as Row[])) as Row[];

// A person's invites: their link code, who joined, and what they earned.
// Invited people are shown by username only, never by name or activity.
export class ReferralsService {
  constructor(private readonly db: FundingDatabase) {}

  async mine(user: string) {
    return actorTransaction(this.db, user, async (tx, actor) => {
      const [me] = rows(
        await tx.execute(sql`
          select u.username,
            exists (select 1 from verified_phones v where v.account_id = ${actor}) as phone_verified,
            (select count(*) from referrals where referrer_id = ${actor})::int as invited,
            (select count(*) from referral_rewards where referrer_id = ${actor})::int as rewarded,
            coalesce((select sum(amount_kobo) from referral_rewards where referrer_id = ${actor}), 0)::text as earned
          from accounts a
          left join usernames u on u.account_id = a.id and u.is_current
          where a.id = ${actor}`),
      );
      const people = rows(
        await tx.execute(sql`
          select r.created_at, u.username,
            exists (select 1 from sponsor_profiles sp where sp.owner_id = r.referee_id) as business,
            coalesce((select sum(amount_kobo) from referral_rewards w
              where w.referee_id = r.referee_id and w.referrer_id = ${actor}), 0)::text as earned
          from referrals r
          left join usernames u on u.account_id = r.referee_id and u.is_current
          where r.referrer_id = ${actor}
          order by r.created_at desc limit 30`),
      ).map((r) => ({
        username: r.username == null ? null : String(r.username),
        business: Boolean(r.business),
        earnedKobo: String(r.earned),
        joinedAt: new Date(String(r.created_at)).toISOString(),
      }));
      return {
        username: me?.username == null ? null : String(me.username),
        phoneVerified: Boolean(me?.phone_verified),
        invited: Number(me?.invited ?? 0),
        rewarded: Number(me?.rewarded ?? 0),
        earnedKobo: String(me?.earned ?? '0'),
        people,
      };
    });
  }
}
