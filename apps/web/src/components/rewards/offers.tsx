'use client';
import Link from 'next/link';
import { ChevronRight, Gift, MapPin } from 'lucide-react';
import { nairaOfKobo, useLimits } from '@/lib/limits';
import { Page } from '@/components/shell/app-shell';
import { Loading } from '@/components/ui/feedback';
import { WorkFailure } from '@/components/work/work-frame';
import { naira, shortDate } from '@/lib/api';
import { offerPage } from '@/lib/rewards';
import { useApiRead } from '@/lib/use-api-read';

// Acticlaim's own ways to earn, shown above the business offers.
function InviteBanner() {
  const { limits, loaded } = useLimits();
  const top = Math.max(
    limits.referrals.friend?.rewardKobo ?? 0,
    limits.referrals.business?.rewardKobo ?? 0,
  );
  if (!loaded || top === 0) return null;
  return (
    <Link className="invite-banner" href="/invite">
      <span className="pick-icon" aria-hidden>
        <Gift size={20} />
      </span>
      <span className="grid">
        <strong>Invite a friend or a business</strong>
        <span className="small-note">
          Acticlaim pays you up to {nairaOfKobo(top)} when they start using it.
        </span>
      </span>
      <ChevronRight size={18} aria-hidden />
    </Link>
  );
}

export function OfferList() {
  const offers = useApiRead('work/tasks?kind=offers&limit=24', offerPage);
  return (
    <Page
      eyebrow="Cash back near you"
      title="Offers"
      intro="Buy where you already shop and get money back. The business locks every naira before the offer goes live."
    >
      <InviteBanner />
      {offers.loading && !offers.data ? (
        <Loading>Loading offers…</Loading>
      ) : offers.error ? (
        <WorkFailure error={offers.error} retry={offers.refresh} />
      ) : offers.data?.items.length ? (
        <ul className="grid-cards">
          {offers.data.items.map((offer) => {
            const left = Math.max(0, offer.capacity - offer.claimed);
            return (
              <li key={offer.id}>
                <Link href={`/offers/${offer.id}`} className="card card-link">
                  <div className="row" style={{ alignItems: 'flex-start' }}>
                    <div style={{ minWidth: 0 }}>
                      <p className="eyebrow truncate">{offer.businessName}</p>
                      <h2 style={{ fontSize: '1.15rem' }}>{offer.title}</h2>
                    </div>
                    <span
                      className={
                        left > 0 ? 'chip chip-ready' : 'chip chip-muted'
                      }
                    >
                      {left > 0 ? `${left} left` : 'Full'}
                    </span>
                  </div>
                  <p style={{ margin: '0.75rem 0 0.25rem' }}>
                    <span className="amount" style={{ fontSize: '1.9rem' }}>
                      {naira(offer.rewardBackingKobo)}
                    </span>{' '}
                    <span className="small-note">back</span>
                  </p>
                  {offer.campaignTerms && (
                    <p className="small-note">
                      {offer.campaignTerms.minSpendKobo === '0'
                        ? 'Any purchase'
                        : `Spend ${naira(offer.campaignTerms.minSpendKobo)} or more`}
                      {offer.campaignTerms.repeat === 'monthly' &&
                        ' · once a month'}
                      {offer.campaignTerms.referral && ' · bring a friend'}
                      {offer.campaignTerms.group &&
                        (offer.groupComplete
                          ? ' · group complete'
                          : ` · group offer: ${Math.min(offer.claimed, offer.campaignTerms.group.target)} of ${offer.campaignTerms.group.target} joined`)}
                    </p>
                  )}
                  {offer.campaignTerms && (
                    <p
                      className="small-note row"
                      style={{
                        justifyContent: 'flex-start',
                        marginTop: '0.75rem',
                      }}
                    >
                      <MapPin size={15} aria-hidden />
                      <span className="truncate">
                        {offer.campaignTerms.placeAddress}
                      </span>
                    </p>
                  )}
                  <p className="small-note">
                    Ends {shortDate(offer.endsAt)}
                    {offer.voidRatePercent !== null &&
                      ` · Business voids ${offer.voidRatePercent}% of purchases`}
                  </p>
                </Link>
              </li>
            );
          })}
        </ul>
      ) : (
        <section className="card">
          <h2>No offers running yet</h2>
          <p className="small-note">
            New cash back offers appear here as soon as businesses fund them and
            they pass review.
          </p>
        </section>
      )}
    </Page>
  );
}
