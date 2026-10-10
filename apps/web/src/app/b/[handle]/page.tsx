import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { PublicBusiness } from '@/components/business/public-business';
import { publicRead, siteOrigin } from '@/lib/site';

const listing = z.object({
  handle: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  listed: z.boolean(),
});

function clean(raw: string) {
  const handle = decodeURIComponent(raw).replace(/^@/, '').toLowerCase();
  return /^[a-z][a-z0-9_]{1,28}[a-z0-9]$/.test(handle) ? handle : null;
}

// A business with an approved campaign is offered to search engines under its
// own name; any other business page stays out of search results.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ handle: string }>;
}): Promise<Metadata> {
  const handle = clean((await params).handle);
  const b = handle ? await publicRead(`businesses/${handle}`, listing) : null;
  if (!b?.listed) return { title: 'Business' };
  const description =
    b.description ??
    `Cash back and prize codes at ${b.name}, paid from money locked in advance on Acticlaim.`;
  const url = `${siteOrigin()}/b/${b.handle}`;
  return {
    title: b.name,
    description,
    alternates: { canonical: url },
    openGraph: { title: b.name, description, url, siteName: 'Acticlaim' },
    robots: { index: true, follow: true },
  };
}

export default async function Page({
  params,
}: {
  params: Promise<{ handle: string }>;
}) {
  const handle = clean((await params).handle);
  if (!handle) notFound();
  return <PublicBusiness key={handle} handle={handle} />;
}
