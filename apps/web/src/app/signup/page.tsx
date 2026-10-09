import Link from 'next/link';
import { Suspense } from 'react';
import { Store, UserRound } from 'lucide-react';
import { AuthFrame } from '@/components/auth/auth-frame';
import { SignupForm } from '@/components/auth/signup-form';
import { Feedback, Loading } from '@/components/ui/feedback';
import { usernameSchema } from '@pointrush/contracts';
export const metadata = { title: 'Create account' };
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Businesses sign up from their own page; the account then opens on
  // business setup instead of the earner app.
  const query = await searchParams;
  const business = query.as === 'business';
  const ref = usernameSchema.safeParse(query.ref);
  const invitedBy = ref.success ? ref.data : null;
  const keep = invitedBy ? `ref=${invitedBy}` : '';
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
      <nav className="account-kind" aria-label="Account type">
        <Link
          href={`/signup${keep ? `?${keep}` : ''}`}
          replace
          aria-current={business ? undefined : 'page'}
        >
          <UserRound size={18} aria-hidden />
          <span>
            <strong>Personal</strong>
            <small>Earn cash back</small>
          </span>
        </Link>
        <Link
          href={`/signup?as=business${keep ? `&${keep}` : ''}`}
          replace
          aria-current={business ? 'page' : undefined}
        >
          <Store size={18} aria-hidden />
          <span>
            <strong>Business</strong>
            <small>Reward customers</small>
          </span>
        </Link>
      </nav>
      {invitedBy && (
        <Feedback>
          <strong>@{invitedBy}</strong> invited you. Sign up and they are
          thanked once you start using Acticlaim.
        </Feedback>
      )}
      <Suspense fallback={<Loading>Loading form…</Loading>}>
        <SignupForm business={business} invitedBy={invitedBy} />
      </Suspense>
    </AuthFrame>
  );
}
