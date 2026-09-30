import { Suspense } from 'react';
import { AuthFrame } from '@/components/auth/auth-frame';
import { LoginForm } from '@/components/auth/login-form';
import { Loading } from '@/components/ui/feedback';
export const metadata = { title: 'Sign in' };
export default function Page() {
  return (
    <AuthFrame
      title={'Welcome back'}
      description={'Sign in to pick up where you left off.'}
      step={0}
    >
      <Suspense fallback={<Loading>Loading form…</Loading>}>
        <LoginForm />
      </Suspense>
    </AuthFrame>
  );
}
