'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { AuthFrame } from '@/components/auth/auth-frame';
import { Button } from '@/components/ui/button';
import { Loading } from '@/components/ui/feedback';
import { RequestError } from '@/lib/auth-client';
import { withNext } from '@/lib/next-path';
import { staffAccess } from '@/lib/staff';
import { useApiRead } from '@/lib/use-api-read';
import NotFound from '@/app/not-found';

// The staff area shows nothing of itself until the API says who is asking:
// signed out goes to sign in, anyone but a reviewer sees "page not found",
// and a reviewer with a stale authenticator check is asked to verify.
export function StaffGate({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const access = useApiRead('staff/access', staffAccess);
  const signedOut =
    access.error instanceof RequestError && access.error.status === 401;
  useEffect(() => {
    if (signedOut) router.replace(withNext('/login', pathname));
  }, [signedOut, router, pathname]);
  if (access.data?.reviewer && access.data.verified) return children;
  if (access.data?.reviewer)
    return (
      <AuthFrame
        title="Check your authenticator"
        description="Admin pages need a code from your authenticator app in the last 15 minutes. Backup codes do not work here."
      >
        <Link
          className="button button-accent full-width"
          href={withNext('/two-factor', pathname)}
        >
          Enter authenticator code
        </Link>
        <Button variant="ghost" onClick={access.refresh}>
          I have verified, check again
        </Button>
      </AuthFrame>
    );
  if (access.loading || signedOut)
    return (
      <main id="main-content" className="auth-content">
        <Loading>Loading…</Loading>
      </main>
    );
  if (access.data || access.error instanceof RequestError) return <NotFound />;
  return (
    <AuthFrame title="Could not load" description="Check your connection.">
      <Button onClick={access.refresh}>Try again</Button>
    </AuthFrame>
  );
}
