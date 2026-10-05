import { Suspense } from 'react';
import { VerifyPhone } from '@/components/rewards/verify-phone';
import { Loading } from '@/components/ui/feedback';
export const metadata = { title: 'Verify your phone' };
export default function Page() {
  return (
    <Suspense fallback={<Loading>Loading…</Loading>}>
      <VerifyPhone />
    </Suspense>
  );
}
