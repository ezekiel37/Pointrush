import { CampaignListPage } from '@/components/business/business-home';
export const metadata = { title: 'Prize promotions' };
export default function Page() {
  return (
    <CampaignListPage
      model="claim_code"
      title="Prize promotions"
      intro="Printed codes you distribute; Acticlaim verifies each claim once."
    />
  );
}
