import { notFound } from 'next/navigation';
import { z } from 'zod';
import { OfferDetail } from '@/components/rewards/offer-detail';
export const metadata = { title: 'Offer' };
// Bring-a-friend links carry the inviter's username: /offers/<id>?ref=ada.
const inviteRef = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z][a-z0-9_]{1,18}[a-z0-9]$/);
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const ref = inviteRef.safeParse((await searchParams).ref);
  return (
    <OfferDetail key={id} id={id} inviteRef={ref.success ? ref.data : null} />
  );
}
