import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { jobsEnabled } from '@/lib/features';
// Hidden while jobs are switched off.
export default function Layout({ children }: { children: ReactNode }) {
  if (!jobsEnabled) notFound();
  return children;
}
