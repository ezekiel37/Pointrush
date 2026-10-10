import type { MetadataRoute } from 'next';
import { siteOrigin } from '@/lib/site';

// Private pages carry their own noindex; listing them here would only
// advertise where they are.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: '*', allow: '/' },
    sitemap: `${siteOrigin()}/sitemap.xml`,
  };
}
