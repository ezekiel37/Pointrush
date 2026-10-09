import { AccountScreen } from '@/components/auth/account-screen';
export const metadata = { title: 'Your account' };
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Straight after signing in, a set-up account goes to its home; opened
  // from the profile, this page shows account settings.
  const home = (await searchParams).home === '1';
  return <AccountScreen goHome={home} />;
}
