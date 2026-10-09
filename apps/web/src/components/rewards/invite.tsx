'use client';
import Link from 'next/link';
import { useSyncExternalStore } from 'react';
import {
  Copy,
  Gift,
  Share2,
  ShieldCheck,
  Store,
  UserRoundPlus,
} from 'lucide-react';
import { Page } from '@/components/shell/app-shell';
import { Button } from '@/components/ui/button';
import { Feedback, Loading } from '@/components/ui/feedback';
import { toast } from '@/components/ui/toast';
import { WorkFailure } from '@/components/work/work-frame';
import { naira, shortDate } from '@/lib/api';
import { nairaOfKobo, useLimits } from '@/lib/limits';
import { myReferrals } from '@/lib/referrals';
import { useApiRead } from '@/lib/use-api-read';

// The page origin, read only in the browser so the server render matches.
const noop = () => () => undefined;
function useOrigin() {
  return useSyncExternalStore(
    noop,
    () => window.location.origin,
    () => '',
  );
}

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast('Link copied');
  } catch {
    toast('Copy failed. Press and hold the link to copy it.', { error: true });
  }
}
async function share(text: string, url: string) {
  if (typeof navigator.share === 'function') {
    try {
      await navigator.share({ title: 'Acticlaim', text, url });
      return;
    } catch (error) {
      // Closing the share sheet is not a failure.
      if (error instanceof DOMException && error.name === 'AbortError') return;
    }
  }
  await copy(url);
}

function LinkCard({
  title,
  body,
  url,
  message,
  icon,
}: {
  title: string;
  body: string;
  url: string;
  message: string;
  icon: React.ReactNode;
}) {
  return (
    <section className="card invite-card">
      <div className="invite-head">
        <span className="pick-icon" aria-hidden>
          {icon}
        </span>
        <div>
          <h2>{title}</h2>
          <p className="small-note">{body}</p>
        </div>
      </div>
      <div className="invite-link">
        <code className="truncate" aria-label={`${title} link`}>
          {url || '…'}
        </code>
        <button
          type="button"
          className="icon-button"
          aria-label={`Copy ${title.toLowerCase()} link`}
          onClick={() => void copy(url)}
          disabled={!url}
        >
          <Copy size={18} aria-hidden />
        </button>
      </div>
      <Button
        variant="accent"
        type="button"
        disabled={!url}
        onClick={() => void share(message, url)}
      >
        <Share2 size={17} aria-hidden /> Share link
      </Button>
    </section>
  );
}

export function Invite() {
  const read = useApiRead('referrals/me', myReferrals);
  const { limits } = useLimits();
  const origin = useOrigin();
  const data = read.data;
  const friend = limits.referrals.friend;
  const biz = limits.referrals.business;
  const link = (business: boolean) =>
    origin && data?.username
      ? `${origin}/join/${data.username}${business ? '?as=business' : ''}`
      : '';
  return (
    <Page
      eyebrow="Invite and earn"
      title="Invite people you know"
      intro="Acticlaim pays you, not the business, when someone you invite starts using Acticlaim for real."
    >
      {read.loading && !data ? (
        <Loading>Loading your invites…</Loading>
      ) : read.error && !data ? (
        <WorkFailure error={read.error} retry={read.refresh} />
      ) : (
        data && (
          <div className="grid gap-5" style={{ maxWidth: 720 }}>
            {!data.phoneVerified && (
              <Feedback>
                Verify your phone so your invites count.{' '}
                <Link href="/verify-phone?next=/invite">Verify now</Link>
              </Feedback>
            )}
            <dl className="stat-row" style={{ margin: 0 }}>
              <div className="stat">
                <dt>Joined with your link</dt>
                <dd className="num">{data.invited}</dd>
              </div>
              <div className="stat">
                <dt>Rewards</dt>
                <dd className="num">{data.rewarded}</dd>
              </div>
              <div className="stat">
                <dt>Earned</dt>
                <dd className="num">{naira(data.earnedKobo)}</dd>
              </div>
            </dl>
            {friend && (
              <LinkCard
                title="Invite a friend"
                icon={<UserRoundPlus size={20} />}
                body={`Earn up to ${nairaOfKobo(friend.rewardKobo)} when they first get at least ${nairaOfKobo(friend.minQualifyingKobo)} cash back from a business. You get the smaller of ${nairaOfKobo(friend.rewardKobo)} and ${friend.maxPercent}% of what they got.`}
                url={link(false)}
                message="Get cash back where you already shop. Join me on Acticlaim:"
              />
            )}
            {biz && (
              <LinkCard
                title="Invite a business"
                icon={<Store size={20} />}
                body={`Earn up to ${nairaOfKobo(biz.rewardKobo)} once they have added ${nairaOfKobo(biz.minFundingKobo)} and paid ${nairaOfKobo(biz.minPaidOutKobo)} cash back to ${biz.minCustomers} different customers: ${biz.maxPercent}% of what they paid, up to ${nairaOfKobo(biz.rewardKobo)}.`}
                url={link(true)}
                message="Reward your customers with cash back and only pay for real sales. Try Acticlaim:"
              />
            )}
            {!friend && !biz && (
              <Feedback>
                Invite rewards are paused at the moment. Your link still works
                and people who join are still counted.
              </Feedback>
            )}
            <section className="card grid gap-2">
              <h2 style={{ margin: 0, fontSize: '1rem' }} className="icon-line">
                <ShieldCheck size={18} aria-hidden /> Fair-play rules
              </h2>
              <ul className="rules-list">
                <li>
                  Rewards come from real money that moved, never sign-ups.
                </li>
                <li>Your own business, or one you work at, never counts.</li>
                <li>
                  Up to {limits.referrals.monthlyCount} rewards a month per
                  person.
                </li>
                <li>
                  They must sign up with your link, or type your username when
                  they set up, within their first week.
                </li>
              </ul>
            </section>
            <section aria-labelledby="joined-heading">
              <h2 id="joined-heading">People you invited</h2>
              {data.people.length ? (
                <ul className="tx-list">
                  {data.people.map((p, i) => (
                    <li key={`${p.username ?? 'new'}-${i}`}>
                      <div className="tx-row">
                        <span className="tx-icon" aria-hidden>
                          {p.business ? (
                            <Store size={18} />
                          ) : (
                            <UserRoundPlus size={18} />
                          )}
                        </span>
                        <div className="tx-main">
                          <p className="tx-title truncate">
                            {p.username ? `@${p.username}` : 'Setting up'}
                          </p>
                          <p className="small-note">
                            Joined {shortDate(p.joinedAt)}
                            {p.business ? ' · business' : ''}
                          </p>
                        </div>
                        <div className="tx-end">
                          {BigInt(p.earnedKobo) > 0n ? (
                            <span className="amount">
                              +{naira(p.earnedKobo)}
                            </span>
                          ) : (
                            <span className="chip chip-pending">Waiting</span>
                          )}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="small-note icon-line">
                  <Gift size={16} aria-hidden /> Nobody yet. Share your link to
                  start.
                </p>
              )}
            </section>
          </div>
        )
      )}
    </Page>
  );
}
