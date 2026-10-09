import { notFound } from 'next/navigation';
import { PublicBusiness } from '@/components/business/public-business';
export const metadata = { title: 'Business' };
export default async function Page({
  params,
}: {
  params: Promise<{ handle: string }>;
}) {
  const handle = decodeURIComponent((await params).handle)
    .replace(/^@/, '')
    .toLowerCase();
  if (!/^[a-z][a-z0-9_]{1,28}[a-z0-9]$/.test(handle)) notFound();
  return <PublicBusiness key={handle} handle={handle} />;
}
