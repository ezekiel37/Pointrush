import { Suspense } from 'react';
import { Loading } from '@/components/ui/feedback';
import { TwoFactorScreen } from '@/components/auth/two-factor-screen';

export const metadata = { title: 'Authenticator security' };

export default function Page() {
  return (
    <Suspense fallback={<Loading>Loading security setup…</Loading>}>
      <TwoFactorScreen />
    </Suspense>
  );
}
