'use client';
import { z } from 'zod';
import { apiRequest } from './api';
import { RequestError } from './auth-client';
import { workplaces } from './rewards';
import { useApiRead } from './use-api-read';

const sponsor = z.object({ id: z.uuid(), name: z.string() });
async function has(path: string, schema: z.ZodType) {
  try {
    return await apiRequest(path, schema);
  } catch (cause) {
    if (cause instanceof RequestError && cause.status === 404) return null;
    throw cause;
  }
}

// Where a person starts after signing in: their business (or business
// setup, if they signed up as a business), the businesses they work for, or
// the personal app.
export async function homePath(accountType: 'personal' | 'business') {
  const [business, work] = await Promise.all([
    has('sponsor/profile', sponsor),
    has('staff/workplaces', workplaces).catch(() => null),
  ]);
  if (business) return '/business';
  if (accountType === 'business') return '/business/setup';
  if (work && (work as z.infer<typeof workplaces>).items.length)
    return '/staff';
  return '/offers';
}

// Whether to show the way into business tools: owners and staff only.
export function useBusinessAccess() {
  const business = useApiRead('sponsor/profile', sponsor);
  const work = useApiRead('staff/workplaces', workplaces);
  return {
    owner: Boolean(business.data),
    staff: Boolean(work.data?.items.length),
    // A 404 (no business) settles as an error, so both count as answered.
    loading:
      (business.loading && !business.data) || (work.loading && !work.data),
  };
}
