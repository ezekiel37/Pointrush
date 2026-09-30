import { Suspense } from 'react';
import { AuthFrame } from '@/components/auth/auth-frame';
import { EmailRequestForm } from '@/components/auth/email-request-form';
import { Loading } from '@/components/ui/feedback';
export const metadata = { title: 'Verify email' };
export default function Page() {
  return (
    <AuthFrame
      title={'Check your inbox'}
      description={'Verify that this email address belongs to you.'}
      step={2}
    >
      <Suspense fallback={<Loading>Loading form…</Loading>}>
        <EmailRequestForm kind="verify" />
      </Suspense>
    </AuthFrame>
  );
}
