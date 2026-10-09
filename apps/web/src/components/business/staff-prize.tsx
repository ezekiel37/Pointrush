'use client';
import Link from 'next/link';
import { Page } from '@/components/shell/app-shell';
import { Loading } from '@/components/ui/feedback';
import { WorkFailure } from '@/components/work/work-frame';
import { workplaces } from '@/lib/rewards';
import { useApiRead } from '@/lib/use-api-read';
import { PrizeHandover } from './prize-handover';

export function StaffPrize({ id }: { id: string }) {
  const read = useApiRead('staff/workplaces', workplaces);
  const prize = read.data?.items
    .flatMap((b) => b.prizes.map((p) => ({ ...p, business: b.name })))
    .find((p) => p.id === id);
  return (
    <Page
      eyebrow={prize?.business ?? 'Staff'}
      title={prize?.title ?? 'Prize handover'}
    >
      <Link className="back-link" href="/staff">
        Back to work
      </Link>
      <div style={{ maxWidth: 560, marginTop: '1rem' }}>
        {read.loading && !read.data ? (
          <Loading>Loading…</Loading>
        ) : read.error && !read.data ? (
          <WorkFailure error={read.error} retry={read.refresh} />
        ) : prize ? (
          <PrizeHandover taskId={prize.id} item={prize.item} />
        ) : (
          <p className="small-note">
            You are not staff for this promotion, or it has closed.
          </p>
        )}
      </div>
    </Page>
  );
}
