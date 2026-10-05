'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const tabs = [
  { href: '/review/campaigns', label: 'Campaigns' },
  { href: '/review/appeals', label: 'Appeals' },
  { href: '/review/accounts', label: 'Accounts' },
  { href: '/review/payments', label: 'Payments' },
];

export function ReviewTabs() {
  const pathname = usePathname();
  return (
    <nav className="pill-tabs" aria-label="Review sections">
      {tabs.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          aria-current={pathname.startsWith(tab.href) ? 'page' : undefined}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
