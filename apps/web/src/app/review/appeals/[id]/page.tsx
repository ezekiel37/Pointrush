import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { AppealReview } from '@/components/work/review-detail';
import { Loading } from '@/components/ui/feedback';
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  return (
    <Suspense fallback={<Loading>Loading…</Loading>}>
      <AppealReview key={id} id={id} />
    </Suspense>
  );
}
