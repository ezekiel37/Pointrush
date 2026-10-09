'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import {
  BriefcaseBusiness,
  Store,
  Tag,
  TicketCheck,
  UserRound,
  Wallet,
} from 'lucide-react';
import { Brand } from '@/components/auth/auth-frame';
import { NotificationBell } from './notification-bell';
import { jobsEnabled } from '@/lib/features';
import { useBusinessAccess } from '@/lib/role';

const tabs = [
  { href: '/offers', label: 'Offers', icon: Tag },
  { href: '/claim', label: 'Claim', icon: TicketCheck },
  ...(jobsEnabled
    ? [{ href: '/tasks', label: 'Jobs', icon: BriefcaseBusiness }]
    : []),
  { href: '/wallet', label: 'Wallet', icon: Wallet },
  { href: '/profile', label: 'Profile', icon: UserRound },
];

function active(pathname: string, href: string) {
  if (href === '/tasks')
    return pathname.startsWith('/tasks') || pathname.startsWith('/my-tasks');
  return pathname === href || pathname.startsWith(`${href}/`);
}

// One navigation model: a top bar on wide screens, a thumb-reach tab bar on
// phones. Business tools sit apart from the earner tabs.
export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  // Only business owners and their staff see the way into business tools.
  const access = useBusinessAccess();
  return (
    <>
      <header className="app-bar">
        <Brand />
        <nav className="app-nav" aria-label="Main">
          {tabs.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              aria-current={active(pathname, href) ? 'page' : undefined}
            >
              <Icon size={17} aria-hidden />
              {label}
            </Link>
          ))}
        </nav>
        <div className="app-bar-end">
          <NotificationBell />
          {(access.owner || access.staff) && (
            <Link
              href={access.owner ? '/business' : '/staff'}
              className="button button-outline"
            >
              <Store size={17} aria-hidden />
              <span>{access.owner ? 'My business' : 'My work'}</span>
            </Link>
          )}
        </div>
      </header>
      {children}
      <nav className="tabbar" aria-label="Main">
        {tabs.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            aria-current={active(pathname, href) ? 'page' : undefined}
          >
            <Icon size={20} aria-hidden />
            {label}
          </Link>
        ))}
      </nav>
    </>
  );
}

export function Page({
  title,
  intro,
  eyebrow,
  children,
}: {
  title: string;
  intro?: ReactNode;
  eyebrow?: string;
  children: ReactNode;
}) {
  return (
    <AppShell>
      <main id="main-content" className="app-main">
        <div className="page-head">
          {eyebrow && <p className="eyebrow">{eyebrow}</p>}
          <h1>{title}</h1>
          {intro && <p>{intro}</p>}
        </div>
        {children}
      </main>
    </AppShell>
  );
}
