'use client';
import type { ReactNode } from 'react';
import { DashHead, DashShell } from '@/components/business/dash-shell';

// Every reviewer page: the reviewer sidebar, a breadcrumb and a quiet title.
export function ReviewFrame({
  title,
  intro,
  section,
  children,
}: {
  title: string;
  intro?: string;
  section?: { label: string; href: string };
  children: ReactNode;
}) {
  return (
    <DashShell
      variant="review"
      crumbs={[
        { label: 'Review', href: '/review/campaigns' },
        ...(section ? [section] : []),
        { label: title },
      ]}
    >
      <DashHead title={title} intro={intro} />
      {children}
    </DashShell>
  );
}
