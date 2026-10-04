import Link from 'next/link';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import type { Metadata } from 'next';
import { Brand } from '@/components/auth/auth-frame';
import { ProfileCard } from '@/components/rewards/profile-card';
import { apiOrigin } from '@/lib/auth-client';
import { profile } from '@/lib/rewards';

// Fetched per request: a profile made private must disappear immediately.
const load = cache(async (username: string) => {
  if (!/^[a-z0-9_]{3,20}$/i.test(username)) return null;
  const response = await fetch(
    `${apiOrigin()}/api/v1/profiles/${encodeURIComponent(username)}`,
    { cache: 'no-store', signal: AbortSignal.timeout(8000) },
  ).catch(() => null);
  if (!response?.ok) return null;
  const parsed = profile.safeParse(await response.json());
  return parsed.success ? parsed.data : null;
});

export async function generateMetadata({
  params,
}: {
  params: Promise<{ username: string }>;
}): Promise<Metadata> {
  const data = await load((await params).username);
  if (!data) return { title: 'Profile not found' };
  const name = data.displayName ?? data.username ?? 'Member';
  return {
    title: `${name}'s record`,
    description: `${data.stats.jobsCompleted} paid jobs and ${data.stats.businesses} businesses, verified by Acticlaim.`,
  };
}

export default async function Page({
  params,
}: {
  params: Promise<{ username: string }>;
}) {
  const data = await load((await params).username);
  if (!data) notFound();
  return (
    <>
      <header className="app-bar">
        <Brand />
        <Link className="button button-outline" href="/signup">
          Join Acticlaim
        </Link>
      </header>
      <main id="main-content" className="app-main" style={{ maxWidth: 760 }}>
        <p className="eyebrow">Verified record</p>
        <ProfileCard data={data} />
        <p className="small-note" style={{ marginTop: '2rem' }}>
          Acticlaim records paid jobs and purchases when businesses settle them.
          It does not verify legal identity.
        </p>
      </main>
    </>
  );
}
