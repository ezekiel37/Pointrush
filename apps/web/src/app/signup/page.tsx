import { Suspense } from 'react';
import { AuthFrame } from '@/components/auth/auth-frame';
import { SignupForm } from '@/components/auth/signup-form';
import { Loading } from '@/components/ui/feedback';
export const metadata = { title: 'Create account' };
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Businesses sign up from their own page; the account then opens on
  // business setup instead of the earner app.
  const business = (await searchParams).as === 'business';
  return (
    <AuthFrame
      title={
        business ? 'Create your business account' : 'Start earning cash back'
      }
      description={
        business
          ? 'Sign up, verify your email, then add your business. You only pay for real customers.'
          : 'Create your account, then verify your email to continue.'
      }
      step={1}
      journeyLabels={
        business
          ? ['Create your account', 'Verify your email', 'Add your business']
          : undefined
      }
    >
      <Suspense fallback={<Loading>Loading form…</Loading>}>
        <SignupForm business={business} />
      </Suspense>
    </AuthFrame>
  );
}
