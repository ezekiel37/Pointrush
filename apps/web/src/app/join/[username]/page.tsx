import { redirect } from 'next/navigation';
import { usernameSchema } from '@pointrush/contracts';

// Invite links: acticlaim.com/join/ada (or ?as=business). The username goes
// to sign-up and is saved on the new account; a bad link just signs up.
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ username: string }>;
  searchParams: Promise<{ as?: string | string[] }>;
}) {
  const [{ username }, { as }] = await Promise.all([params, searchParams]);
  const parsed = usernameSchema.safeParse(decodeURIComponent(username));
  const query = new URLSearchParams();
  if (as === 'business') query.set('as', 'business');
  if (parsed.success) query.set('ref', parsed.data);
  redirect(`/signup${query.size ? `?${query}` : ''}`);
}
