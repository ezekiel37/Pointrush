import type { z } from 'zod';
import { apiOrigin } from './api-origin';

// The site's own address, for search engines: the API's address without
// "api." (api.acticlaim.com serves acticlaim.com).
export function siteOrigin() {
  try {
    return apiOrigin().replace('://api.', '://');
  } catch {
    return 'https://acticlaim.com';
  }
}

// A public read that tells "does not exist" (404) apart from "could not
// ask" (network or server trouble), so only a real 404 becomes one.
export async function publicLookup<T>(
  path: string,
  schema: z.ZodType<T>,
): Promise<{ found: T } | 'missing' | null> {
  try {
    const response = await fetch(`${apiOrigin()}/api/v1/${path}`, {
      next: { revalidate: 300 },
      signal: AbortSignal.timeout(5000),
    });
    if (response.status === 404) return 'missing';
    if (!response.ok) return null;
    const parsed = schema.safeParse(await response.json());
    return parsed.success ? { found: parsed.data } : null;
  } catch {
    return null;
  }
}

// Server-side public reads for search metadata. Never fails a page: no
// answer means the page is simply not offered to search engines.
export async function publicRead<T>(path: string, schema: z.ZodType<T>) {
  try {
    const response = await fetch(`${apiOrigin()}/api/v1/${path}`, {
      next: { revalidate: 300 },
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return null;
    const parsed = schema.safeParse(await response.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
