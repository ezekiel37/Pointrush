import Link from 'next/link';
import type { ReactNode } from 'react';
import { Brand } from '@/components/auth/auth-frame';
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
    <>
      <header className="account-header">
        <Brand />
        <nav aria-label="Task navigation">
          <Link href="/tasks">Tasks</Link>
          <Link href="/my-tasks">My tasks</Link>
          <Link href="/account">Account</Link>
        </nav>
      </header>
      <main id="main-content" className="account-content work-content">
        <h1>{title}</h1>
        {children}
      </main>
    </>
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
