import { notFound } from 'next/navigation';
import { z } from 'zod';
import { AdminPerson } from '@/components/admin/admin-people';
export const metadata = { title: 'Account' };
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  return <AdminPerson key={id} id={id} />;
}
