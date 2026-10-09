import { notFound } from 'next/navigation';
import { z } from 'zod';
import { CampaignTill } from '@/components/business/campaign-till';
export const metadata = { title: 'Confirm a purchase' };
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  return <CampaignTill key={id} id={id} />;
}
