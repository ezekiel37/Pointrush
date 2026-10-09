'use client';
import { z } from 'zod';
import { apiRequest } from './api';
import { RequestError } from './auth-client';
import { workplaces } from './rewards';
import { useApiRead } from './use-api-read';

const sponsor = z.object({ id: z.uuid(), name: z.string() });
// Set when someone signs up from a business page, so their first sign-in
// goes to business setup even before the business exists.
export const BUSINESS_INTENT_KEY = 'acticlaim:intent-business';

export function rememberBusinessIntent() {
  try {
    localStorage.setItem(BUSINESS_INTENT_KEY, '1');
  } catch {
    // Not stored; the sign-in link still carries the business next step.
  }
}
function businessIntent() {
  try {
    return localStorage.getItem(BUSINESS_INTENT_KEY) === '1';
  } catch {
    return false;
  }
}

async function has(path: string, schema: z.ZodType) {
  try {
    return await apiRequest(path, schema);
  } catch (cause) {
    if (cause instanceof RequestError && cause.status === 404) return null;
    throw cause;
  }
}

// Where a person starts after signing in: their business, the tills they
// work at, or the earner app.
export async function homePath() {
  const [business, work] = await Promise.all([
    has('sponsor/profile', sponsor),
    has('staff/workplaces', workplaces).catch(() => null),
  ]);
  if (business) {
    // The business exists now; the sign-up hint has done its job.
    try {
      localStorage.removeItem(BUSINESS_INTENT_KEY);
    } catch {
      // Nothing stored.
    }
    return '/business';
  }
  if (businessIntent()) return '/business/setup';
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
