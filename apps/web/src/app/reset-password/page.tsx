import { Suspense } from 'react';
import { AuthFrame } from '@/components/auth/auth-frame';
import { ResetForm } from '@/components/auth/reset-form';
import { Loading } from '@/components/ui/feedback';
export const metadata = { title: 'Choose password' };
export default function Page() {
  return (
    <AuthFrame
      title={'A fresh start'}
      description={'Choose a new password for your Acticlaim account.'}
      step={0}
    >
      <Suspense fallback={<Loading>Loading form…</Loading>}>
        <ResetForm />
      </Suspense>
    </AuthFrame>
  );
}
