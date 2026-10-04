import { Suspense } from 'react';
import { SponsorTasks } from '@/components/work/review-lists';
import { Loading } from '@/components/ui/feedback';
export default function Page() {
  return (
    <Suspense fallback={<Loading>Loading…</Loading>}>
      <SponsorTasks />
    </Suspense>
  );
}
