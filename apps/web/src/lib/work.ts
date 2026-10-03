import { z } from 'zod';
import { apiOrigin, RequestError } from './auth-client';
const money = z.string().regex(/^\d+$/);
export const taskSummary = z.object({
  id: z.uuid(),
  title: z.string(),
  businessName: z.string(),
  startsAt: z.iso.datetime({ offset: true }),
  endsAt: z.iso.datetime({ offset: true }),
  capacity: z.number().int().positive(),
  claimed: z.number().int().nonnegative(),
  rewardBackingKobo: money,
});
export const taskPage = z.object({
  items: z.array(taskSummary),
  nextCursor: z.uuid().nullable(),
});
export const claimPage = z.object({
  items: z.array(
    z.object({
      id: z.uuid(),
      taskId: z.uuid(),
      title: z.string(),
      joinedAt: z.iso.datetime({ offset: true }),
      endsAt: z.iso.datetime({ offset: true }),
      latestProofId: z.uuid().nullable(),
      approvedBackingKobo: money,
    }),
  ),
  nextCursor: z.uuid().nullable(),
});
export const taskDetail = taskSummary.omit({ businessName: true }).extend({
  instructions: z.string(),
  proofRequirements: z.string(),
  rejectionCriteria: z.string(),
  termsVersion: z.number(),
  workTerms: z.object({
    reviewHours: z.number(),
    correctionHours: z.number(),
    appealHours: z.number(),
    settlement: z.literal('approved_reward_backing'),
  }),
});
export const claimResult = z.object({
  id: z.uuid(),
  taskId: z.uuid(),
  accountId: z.uuid(),
  createdAt: z.string(),
});
export async function workRequest<T>(
  path: string,
  schema: z.ZodType<T>,
  signal?: AbortSignal,
  post = false,
  body?: unknown,
): Promise<T> {
  const response = await fetch(`${apiOrigin()}/api/v1/work/${path}`, {
    method: post ? 'POST' : 'GET',
    ...(body === undefined
      ? {}
      : {
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }),
    credentials: 'include',
    cache: 'no-store',
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(15000)])
      : AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new RequestError(response.status);
  return schema.parse(await response.json());
}
export function workError(error: unknown) {
  if (error instanceof RequestError) {
    if (error.status === 401)
      return 'Your session has ended. Sign in again to continue.';
    if (error.status === 403)
      return 'This action is unavailable for your account. Check your account status and email verification.';
    if (error.status === 404)
      return 'This task is not available. Return to tasks to find another opportunity.';
    if (error.status === 409)
      return 'The task is no longer eligible for this action. Refresh its details before trying again.';
    if (error.status === 400)
      return 'This page link or search is invalid. Return to the first page and try again.';
  }
  return 'We could not confirm the result. Check your connection and try again. Repeating a join request will not create a second place.';
}
