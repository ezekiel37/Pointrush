import { Suspense } from 'react';
import { CampaignListPage } from '@/components/business/business-home';
import { Loading } from '@/components/ui/feedback';
export const metadata = { title: 'Prize promotions' };
export default function Page() {
  return (
    <Suspense fallback={<Loading>Loading…</Loading>}>
      <CampaignListPage
        model="claim_code"
        title="Prize promotions"
        intro="Printed codes you distribute; Acticlaim verifies each claim once."
      />
    </Suspense>
  );
}
