import { sql } from 'drizzle-orm';
import type { FundingDatabase } from '../funding/funding-ledger.js';
import { actorTransaction } from '../tasks/actor-transaction.js';

type Row = Record<string, unknown>;
const rows = (result: unknown) =>
  ((result as { rows?: Row[] }).rows ?? (result as Row[])) as Row[];

const naira = (kobo: unknown) => {
  const value = BigInt(String(kobo ?? '0'));
  const rest = value % 100n;
  return `₦${(value / 100n).toLocaleString('en-NG')}${rest ? `.${rest.toString().padStart(2, '0')}` : ''}`;
};

// What each event says and where it leads. Text is plain and specific.
function describe(r: Row) {
  const amount = naira(r.amount_kobo);
  const title = String(r.title ?? '');
  const business = String(r.business ?? '');
  const reason = r.reason == null ? '' : String(r.reason);
  switch (r.kind) {
    case 'cashback_ready':
      return {
        title: `${amount} cash back is ready`,
        body: `From ${business}. Move it to your wallet.`,
        href: '/wallet',
      };
    case 'cashback_voided':
      return {
        title: `${business} voided your cash back`,
        body: reason,
        href: '/wallet',
      };
    case 'withdrawal_paid':
      return {
        title: `${amount} withdrawal paid`,
        body: 'The payment provider confirmed it.',
        href: '/wallet',
      };
    case 'withdrawal_failed':
      return {
        title: `${amount} withdrawal returned`,
        body: 'The payout failed, so the money is back in your wallet.',
        href: '/wallet',
      };
    case 'review_approved':
      return {
        title: `“${title}” was approved`,
        body: 'Publish it when you are ready.',
        href: '/business/campaigns',
      };
    case 'review_changes_required':
      return {
        title: `“${title}” needs changes`,
        body: reason,
        href: '/business/campaigns',
      };
    case 'review_rejected':
      return {
        title: `“${title}” was not approved`,
        body: reason,
        href: '/business/campaigns',
      };
    case 'funding_confirmed':
      return {
        title: `${amount} added to your balance`,
        body: 'The payment provider confirmed your payment.',
        href: '/business/funds',
      };
    case 'bank_added':
      return {
        title: 'Bank account added',
        body: `${reason} (${business}). Not you? Open your wallet and press "This wasn't me".`,
        href: '/wallet',
      };
    case 'withdrawals_locked':
      return {
        title: 'Withdrawals locked',
        body: 'Your balance is safe. Support will check your account before withdrawals open again.',
        href: '/wallet',
      };
    default:
      return {
        title: `${amount} returned to your balance`,
        body: `Unused money from “${title}”.`,
        href: '/business/funds',
      };
  }
}

export class NotificationsService {
  constructor(private readonly db: FundingDatabase) {}

  async list(user: string) {
    return actorTransaction(this.db, user, async (tx, actor) => {
      const events = rows(
        await tx.execute(sql`
          select * from (
            select 'cashback_ready:' || p.id as id, 'cashback_ready' as kind, p.release_at as at,
              t.title, sp.name as business, t.reward_kobo::text as amount_kobo, null as reason
            from purchase_confirmations p
            join sponsor_tasks t on t.id = p.task_id
            join sponsor_profiles sp on sp.id = t.sponsor_id
            where p.account_id = ${actor} and p.release_at <= clock_timestamp()
              and not exists (select 1 from purchase_voids v where v.confirmation_id = p.id)
              and not exists (select 1 from purchase_releases r where r.confirmation_id = p.id)
            union all
            select 'cashback_voided:' || p.id, 'cashback_voided', v.created_at,
              t.title, sp.name, t.reward_kobo::text, v.reason
            from purchase_voids v
            join purchase_confirmations p on p.id = v.confirmation_id
            join sponsor_tasks t on t.id = p.task_id
            join sponsor_profiles sp on sp.id = t.sponsor_id
            where p.account_id = ${actor}
            union all
            select 'withdrawal:' || w.id, 'withdrawal_' || o.outcome, o.created_at,
              null, null, w.amount_kobo::text, null
            from withdrawal_outcomes o join withdrawals w on w.id = o.withdrawal_id
            where w.account_id = ${actor}
            union all
            select 'review:' || r.id, 'review_' || r.decision, r.created_at,
              t.title, sp.name, null, r.reason
            from task_reviews r
            join sponsor_tasks t on t.id = r.task_id
            join sponsor_profiles sp on sp.id = t.sponsor_id
            where sp.owner_id = ${actor}
            union all
            select 'transfer:' || f.id, f.kind, f.created_at,
              t.title, null, f.amount_kobo::text, null
            from funding_transfers f
            join funding_accounts a on a.id = f.destination_id
            left join sponsor_tasks t on t.allocation_account_id = f.source_id
            where a.owner_id = ${actor} and a.bucket = 'available'
              and f.kind in ('funding_confirmed', 'campaign_return')
            union all
            select 'bank:' || d.id, 'bank_added', d.created_at,
              null, d.bank_name || ' ending ' || d.account_last4, null, d.account_name
            from payout_destinations d
            where d.account_id = ${actor}
            union all
            select 'lock:' || l.id, 'withdrawals_locked', l.created_at,
              null, null, null, null
            from withdrawal_locks l
            where l.account_id = ${actor}
          ) e
          where e.at > clock_timestamp() - interval '30 days'
          order by e.at desc, e.id
          limit 30`),
      );
      const [read] = rows(
        await tx.execute(
          sql`select seen_until from notification_reads where account_id = ${actor}`,
        ),
      );
      const seen = read ? new Date(String(read.seen_until)).getTime() : 0;
      const items = events.map((r) => {
        const at = new Date(String(r.at));
        return {
          id: String(r.id),
          kind: String(r.kind),
          at: at.toISOString(),
          unread: at.getTime() > seen,
          ...describe(r),
        };
      });
      return { items, unread: items.filter((i) => i.unread).length };
    });
  }

  // Marks everything up to now as read. The marker only ever moves forward.
  async markSeen(user: string) {
    return actorTransaction(this.db, user, async (tx, actor) => {
      await tx.execute(sql`
        insert into notification_reads (account_id, seen_until)
        values (${actor}, clock_timestamp())
        on conflict (account_id) do update
          set seen_until = greatest(notification_reads.seen_until, excluded.seen_until)`);
      return { unread: 0 };
    });
  }
}
