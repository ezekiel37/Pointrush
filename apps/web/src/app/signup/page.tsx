import { Suspense } from 'react';
import { AuthFrame } from '@/components/auth/auth-frame';
import { SignupForm } from '@/components/auth/signup-form';
import { Loading } from '@/components/ui/feedback';
export const metadata = { title: 'Create account' };
export default function Page() {
  return (
    <AuthFrame
      title={'Your next step starts here'}
      description={'Create your account, then verify your email to continue.'}
      step={1}
    >
      <Suspense fallback={<Loading>Loading form…</Loading>}>
        <SignupForm />
      </Suspense>
    </AuthFrame>
  );
}
