import { Suspense } from 'react';
import { Loading } from '@/components/ui/feedback';
import { PrizeClaimScreen } from '@/components/rewards/claim-screen';
export const metadata = { title: 'Claim a prize' };
export default function Page() {
  return (
    <Suspense fallback={<Loading>Loading…</Loading>}>
      <PrizeClaimScreen />
    </Suspense>
  );
}
