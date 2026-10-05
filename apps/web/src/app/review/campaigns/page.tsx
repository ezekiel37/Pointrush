import { Suspense } from 'react';
import { CampaignQueue } from '@/components/review/campaign-review';
import { Loading } from '@/components/ui/feedback';
export const metadata = { title: 'Campaign review' };
export default function Page() {
  return (
    <Suspense fallback={<Loading>Loading…</Loading>}>
      <CampaignQueue />
    </Suspense>
  );
}
