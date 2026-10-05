'use client';
import type { z } from 'zod';
import type { pointsSummary } from '@/lib/rewards';

// Points and tier: progress, not money, so they live on the profile.
export function PointsAndTier({
  data,
}: {
  data: z.infer<typeof pointsSummary>;
}) {
  const progress =
    data.tier.next && data.tier.next.businesses > 0
      ? Math.min(1, data.tier.businesses / data.tier.next.businesses)
      : 1;
  return (
    <section
      className="grid gap-3"
      style={{
        gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 260px), 1fr))',
      }}
    >
      <div className="card grid gap-2">
        <p className="eyebrow">Points</p>
        <p style={{ margin: 0 }}>
          <span className="amount" style={{ fontSize: '1.8rem' }}>
            {BigInt(data.points.available).toLocaleString('en-NG')}
          </span>{' '}
          <span className="small-note">available</span>
        </p>
        <p className="small-note num">
          {BigInt(data.points.pending).toLocaleString('en-NG')} pending · points
          are not cash
        </p>
      </div>
      <div className="card grid gap-2">
        <p className="eyebrow">Tier</p>
        <p
          style={{
            margin: 0,
            fontFamily: 'var(--font-heading)',
            fontSize: '1.6rem',
            fontWeight: 700,
          }}
        >
          {data.tier.name}
        </p>
        {data.tier.next ? (
          <>
            <div
              className="countdown-track"
              role="progressbar"
              aria-label={`Progress to ${data.tier.next.name}`}
              aria-valuemin={0}
              aria-valuemax={data.tier.next.businesses}
              aria-valuenow={data.tier.businesses}
            >
              <div
                className="countdown-fill"
                style={{ transform: `scaleX(${progress})` }}
              />
            </div>
            <p className="small-note num">
              {data.tier.businesses} of {data.tier.next.businesses} different
              businesses for {data.tier.next.name}
            </p>
          </>
        ) : (
          <p className="small-note">Highest tier reached.</p>
        )}
      </div>
    </section>
  );
}
