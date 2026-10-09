'use client';
import type { ReactNode } from 'react';
import { RequestError } from '@/lib/auth-client';
import { DashHead, DashShell } from '@/components/business/dash-shell';
import { WorkFailure } from '@/components/work/work-frame';
import { ReviewAccess } from '@/components/work/review-access';

export const denied = (error: unknown) =>
  error instanceof RequestError &&
  (error.status === 401 || error.status === 403);

// Every admin page: the reviewer sidebar under an Admin breadcrumb.
export function AdminFrame({
  title,
  intro,
  section,
  actions,
  children,
}: {
  title: string;
  intro?: string;
  section?: { label: string; href: string };
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <DashShell
      variant="review"
      crumbs={[
        { label: 'Admin', href: '/admin' },
        ...(section ? [section] : []),
        { label: title },
      ]}
    >
      <DashHead title={title} intro={intro} actions={actions} />
      {children}
    </DashShell>
  );
}

// Signed-in people without a reviewer appointment and a recent
// authenticator check see how to get in, not an error.
export function AdminFailure({
  error,
  retry,
}: {
  error: unknown;
  retry: () => void;
}) {
  return denied(error) ? (
    <section className="card grid gap-3" style={{ maxWidth: 620 }}>
      <h2 style={{ margin: 0 }}>Admin access needed</h2>
      <ReviewAccess />
    </section>
  ) : (
    <WorkFailure error={error} retry={retry} />
  );
}
