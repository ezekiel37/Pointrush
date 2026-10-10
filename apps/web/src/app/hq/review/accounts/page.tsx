import { AccountTools } from '@/components/review/admin-tools';
export const metadata = { title: 'Accounts' };
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ username?: string | string[] }>;
}) {
  // Opened from an admin account page with the username filled in.
  const { username } = await searchParams;
  return (
    <AccountTools initial={typeof username === 'string' ? username : ''} />
  );
}
