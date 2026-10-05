import { notFound } from 'next/navigation';
import { z } from 'zod';
import { StaffPrize } from '@/components/business/staff-prize';
export const metadata = { title: 'Prize handover' };
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  return <StaffPrize key={id} id={id} />;
}
