import { notFound } from 'next/navigation';
import { z } from 'zod';
import { CampaignReview } from '@/components/review/campaign-review';
export const metadata = { title: 'Campaign review' };
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  return <CampaignReview key={id} id={id} />;
}
