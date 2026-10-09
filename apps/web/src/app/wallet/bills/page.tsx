import { Bills } from '@/components/rewards/bills';
import { billKind } from '@/lib/bills';
export const metadata = { title: 'Airtime, data and bills' };
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string | string[] }>;
}) {
  // The wallet's quick actions open the right tab: /wallet/bills?kind=tv
  const kind = billKind.safeParse((await searchParams).kind);
  return <Bills initialKind={kind.success ? kind.data : 'airtime'} />;
}
