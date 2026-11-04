import type { ReactNode } from 'react';
import { StaffGate } from '@/components/admin/staff-gate';

export default function StaffLayout({ children }: { children: ReactNode }) {
  return <StaffGate>{children}</StaffGate>;
}
