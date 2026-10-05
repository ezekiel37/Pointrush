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

const tabs = [
  { href: '/offers', label: 'Offers', icon: Tag },
  { href: '/claim', label: 'Claim', icon: TicketCheck },
  { href: '/tasks', label: 'Jobs', icon: BriefcaseBusiness },
  { href: '/wallet', label: 'Wallet', icon: Wallet },
  { href: '/profile', label: 'Profile', icon: UserRound },
] as const;

function active(pathname: string, href: string) {
  if (href === '/tasks')
    return pathname.startsWith('/tasks') || pathname.startsWith('/my-tasks');
  return pathname === href || pathname.startsWith(`${href}/`);
}

// One navigation model: a top bar on wide screens, a thumb-reach tab bar on
// phones. Business tools sit apart from the earner tabs.
export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
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
          <Link
            href="/business"
            className="button button-outline"
            aria-current={pathname.startsWith('/business') ? 'page' : undefined}
          >
            <Store size={17} aria-hidden />
            <span>Business</span>
          </Link>
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
