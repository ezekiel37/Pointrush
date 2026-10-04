import { notFound } from 'next/navigation';
import { z } from 'zod';
import { OfferDetail } from '@/components/rewards/offer-detail';
export const metadata = { title: 'Offer' };
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  return <OfferDetail key={id} id={id} />;
}
