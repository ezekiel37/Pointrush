import { Suspense } from 'react';
import { CampaignListPage } from '@/components/business/business-home';
import { Loading } from '@/components/ui/feedback';
export const metadata = { title: 'Cash back offers' };
export default function Page() {
  return (
    <Suspense fallback={<Loading>Loading…</Loading>}>
      <CampaignListPage
        model="purchase_cashback"
        title="Cash back offers"
        intro="Pay shoppers back for purchases you confirm in your shop."
      />
    </Suspense>
  );
}
