import { CampaignListPage } from '@/components/business/business-home';
export const metadata = { title: 'Cash back offers' };
export default function Page() {
  return (
    <CampaignListPage
      model="purchase_cashback"
      title="Cash back offers"
      intro="Pay shoppers back for purchases you confirm at the till."
    />
  );
}
