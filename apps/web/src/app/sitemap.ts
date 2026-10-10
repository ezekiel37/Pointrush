import type { MetadataRoute } from 'next';
import { z } from 'zod';
import { publicRead, siteOrigin } from '@/lib/site';

// Rebuilt at most hourly, so new listed businesses appear without a deploy.
export const revalidate = 3600;

const listed = z.object({
  items: z.array(z.object({ handle: z.string(), updatedAt: z.string() })),
});

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const site = siteOrigin();
  const fixed: MetadataRoute.Sitemap = [
    { url: site, changeFrequency: 'weekly', priority: 1 },
    { url: `${site}/help`, changeFrequency: 'monthly', priority: 0.5 },
    { url: `${site}/terms`, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${site}/privacy`, changeFrequency: 'yearly', priority: 0.3 },
  ];
  const businesses = await publicRead('businesses', listed);
  return [
    ...fixed,
    ...(businesses?.items ?? []).map((b) => ({
      url: `${site}/b/${b.handle}`,
      lastModified: new Date(b.updatedAt),
      changeFrequency: 'daily' as const,
      priority: 0.7,
    })),
  ];
}
