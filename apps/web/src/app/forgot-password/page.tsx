import { Suspense } from 'react';
import { AuthFrame } from '@/components/auth/auth-frame';
import { EmailRequestForm } from '@/components/auth/email-request-form';
import { Loading } from '@/components/ui/feedback';
export const metadata = { title: 'Reset password' };
export default function Page() {
  return (
    <AuthFrame
      title={'Let’s get you back in'}
      description={'Enter your email to request a password reset link.'}
      step={0}
    >
      <Suspense fallback={<Loading>Loading form…</Loading>}>
        <EmailRequestForm kind="reset" />
      </Suspense>
    </AuthFrame>
  );
}
