import { notFound } from 'next/navigation';
import { CampaignForm } from '@/components/business/campaign-form';
import { jobsEnabled } from '@/lib/features';
export const metadata = { title: 'Post a paid job' };
export default function Page() {
  if (!jobsEnabled) notFound();
  return <CampaignForm model="capped_fixed" />;
}
