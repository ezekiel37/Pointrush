import { CampaignForm } from '@/components/business/campaign-form';
export const metadata = { title: 'New cash back offer' };
export default function Page() {
  return <CampaignForm model="purchase_cashback" />;
}
