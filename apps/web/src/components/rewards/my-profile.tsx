'use client';
import Link from 'next/link';
import { useState } from 'react';
import { Copy, Eye, EyeOff } from 'lucide-react';
import { Page } from '@/components/shell/app-shell';
import { Button } from '@/components/ui/button';
import { Feedback, Loading } from '@/components/ui/feedback';
import { WorkFailure } from '@/components/work/work-frame';
import { apiRequest } from '@/lib/api';
import { ownProfile, pointsSummary } from '@/lib/rewards';
import { useApiRead } from '@/lib/use-api-read';
import { ProfileCard } from './profile-card';

export function MyProfile() {
  const profile = useApiRead('profiles/me', ownProfile);
  const points = useApiRead('points', pointsSummary);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const data = profile.data;
  const link =
    data?.username && typeof window !== 'undefined'
      ? `${window.location.origin}/p/${data.username}`
      : '';

  async function setVisibility(visible: boolean) {
    if (busy) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await apiRequest('profiles/me/visibility', ownProfile, {
        method: 'POST',
        body: { public: visible },
      });
      setMessage(
        visible
          ? 'Your profile is public. Anyone with the link can see it.'
          : 'Your profile is private again.',
      );
    } catch {
      setError('We could not change your profile visibility. Try again.');
    } finally {
      setBusy(false);
      profile.refresh();
    }
  }

  async function copy(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value);
      setMessage(`${label} copied.`);
    } catch {
      setMessage(`Copy failed. Your ${label.toLowerCase()} is: ${value}`);
    }
  }

  return (
    <Page
      eyebrow="Proof profile"
      title="Your record"
      intro="Built only from paid jobs and verified purchases. Share it as proof that you deliver."
    >
      {profile.loading && !data ? (
        <Loading>Loading your profile…</Loading>
      ) : profile.error && !data ? (
        <WorkFailure error={profile.error} retry={profile.refresh} />
      ) : (
        data && (
          <div className="grid gap-6" style={{ maxWidth: 760 }}>
            <section className="card grid gap-3">
              <div className="row" style={{ flexWrap: 'wrap' }}>
                <div>
                  <p style={{ margin: 0, fontWeight: 600 }}>
                    {data.public ? 'Public profile' : 'Private profile'}
                  </p>
                  <p className="small-note">
                    {data.public
                      ? 'Anyone with your link can see this page. Where you shop is never shown.'
                      : 'Only you can see this. Publish it to share a link.'}
                  </p>
                </div>
                <Button
                  variant={data.public ? 'outline' : 'accent'}
                  type="button"
                  disabled={busy || !data.username}
                  onClick={() => void setVisibility(!data.public)}
                >
                  {data.public ? (
                    <EyeOff size={17} aria-hidden />
                  ) : (
                    <Eye size={17} aria-hidden />
                  )}
                  {data.public ? 'Make private' : 'Publish profile'}
                </Button>
              </div>
              {data.public && link && (
                <div className="row" style={{ flexWrap: 'wrap' }}>
                  <Link className="num truncate" href={`/p/${data.username}`}>
                    {link}
                  </Link>
                  <Button
                    variant="ghost"
                    type="button"
                    onClick={() => void copy(link, 'Link')}
                  >
                    <Copy size={16} aria-hidden /> Copy link
                  </Button>
                </div>
              )}
              {message && <Feedback>{message}</Feedback>}
              {error && <Feedback error>{error}</Feedback>}
            </section>

            <ProfileCard data={data} />

            {points.data?.referral.code && (
              <section className="card grid gap-2">
                <p className="eyebrow">Invite someone</p>
                <p className="small-note">
                  New members can enter your username when they join. You both
                  earn points after their first verified purchase or paid job at
                  a business you do not own.
                </p>
                <div className="row">
                  <span className="amount" style={{ fontSize: '1.3rem' }}>
                    {points.data.referral.code}
                  </span>
                  <Button
                    variant="ghost"
                    type="button"
                    onClick={() =>
                      void copy(points.data!.referral.code!, 'Username')
                    }
                  >
                    <Copy size={16} aria-hidden /> Copy
                  </Button>
                </div>
                <p className="small-note num">
                  {points.data.referral.referred} invited ·{' '}
                  {points.data.referral.rewarded} rewarded
                </p>
              </section>
            )}
            <Link className="text-link" href="/account">
              Account settings
            </Link>
          </div>
        )
      )}
    </Page>
  );
}
