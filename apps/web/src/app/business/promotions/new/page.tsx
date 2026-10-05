import { CampaignForm } from '@/components/business/campaign-form';
export const metadata = { title: 'New prize promotion' };
export default function Page() {
  return <CampaignForm model="claim_code" />;
}
