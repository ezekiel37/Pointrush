import { notFound } from 'next/navigation';
import { z } from 'zod';
import { ClaimScreen } from '@/components/work/claim-screen';
export const metadata = { title: 'Your submission' };
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  return <ClaimScreen key={id} id={id} />;
}
