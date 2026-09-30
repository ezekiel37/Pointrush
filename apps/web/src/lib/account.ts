import { z } from 'zod';
import { apiOrigin, RequestError } from './auth-client';
const statusSchema = z.discriminatedUnion('onboarding', [
  z.object({ onboarding: z.literal('required'), account: z.null() }),
  z.object({
    onboarding: z.literal('complete'),
    account: z.object({
      id: z.uuid(),
      username: z.string(),
      displayName: z.string(),
      accessState: z.enum(['active', 'restricted', 'suspended', 'closed']),
    }),
  }),
]);
export type AccountStatus = z.infer<typeof statusSchema>;
export async function getAccount(signal?: AbortSignal): Promise<AccountStatus> {
  const response = await fetch(`${apiOrigin()}/api/v1/accounts/me`, {
    credentials: 'include',
    cache: 'no-store',
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(15000)])
      : AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new RequestError(response.status);
  return statusSchema.parse(await response.json());
}
export async function createAccount(input: {
  username: string;
  displayName: string;
}) {
  const response = await fetch(`${apiOrigin()}/api/v1/accounts/me`, {
    method: 'POST',
    credentials: 'include',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new RequestError(response.status);
}
