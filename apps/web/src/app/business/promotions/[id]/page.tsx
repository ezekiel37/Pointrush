import { notFound } from 'next/navigation';
import { z } from 'zod';
import { PromotionManager } from '@/components/business/promotion-manager';
export const metadata = { title: 'Promotion' };
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  return <PromotionManager key={id} id={id} />;
}
