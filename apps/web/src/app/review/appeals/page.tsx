import { Suspense } from 'react';
import { AppealQueue } from '@/components/work/review-lists';
import { Loading } from '@/components/ui/feedback';
export default function Page() {
  return (
    <Suspense fallback={<Loading>Loading…</Loading>}>
      <AppealQueue />
    </Suspense>
  );
}
