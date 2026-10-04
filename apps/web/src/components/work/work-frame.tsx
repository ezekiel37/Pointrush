import Link from 'next/link';
import type { ReactNode } from 'react';
import { AppShell } from '@/components/shell/app-shell';
import { Button } from '@/components/ui/button';
import { Feedback } from '@/components/ui/feedback';
import { RequestError } from '@/lib/auth-client';
import { workError } from '@/lib/work';
export function WorkFrame({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <AppShell>
      <main id="main-content" className="app-main work-content">
        <h1>{title}</h1>
        {children}
      </main>
    </AppShell>
  );
}
export function WorkFailure({
  error,
  retry,
}: {
  error: unknown;
  retry: () => void;
}) {
  return (
    <div className="grid gap-3">
      <Feedback error>{workError(error)}</Feedback>
      <div className="flex flex-wrap gap-3">
        <Button variant="outline" onClick={retry}>
          Try again
        </Button>
        <Link
          className="text-link"
          href={
            error instanceof RequestError && error.status === 401
              ? '/login'
              : '/account'
          }
        >
          {error instanceof RequestError && error.status === 401
            ? 'Sign in'
            : 'Check account'}
        </Link>
        <Link className="text-link" href="/tasks">
          First task page
        </Link>
      </div>
    </div>
  );
}
