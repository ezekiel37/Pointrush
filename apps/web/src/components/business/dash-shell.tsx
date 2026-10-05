'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import {
  ArrowLeftRight,
  BriefcaseBusiness,
  CircleHelp,
  LayoutGrid,
  Landmark,
  ScanLine,
  TicketCheck,
} from 'lucide-react';
import { Brand } from '@/components/auth/auth-frame';

const groups = [
  {
    title: 'Operations',
    links: [
      { href: '/business', label: 'Overview', icon: LayoutGrid, exact: true },
      { href: '/business/campaigns', label: 'Cash back', icon: ScanLine },
      {
        href: '/business/promotions',
        label: 'Prize promotions',
        icon: TicketCheck,
      },
      { href: '/business/funds', label: 'Funds', icon: Landmark },
    ],
  },
  {
    title: 'Work',
    links: [{ href: '/sponsor/tasks', label: 'Jobs', icon: BriefcaseBusiness }],
  },
  {
    title: 'Support',
    links: [{ href: '/help', label: 'Help', icon: CircleHelp }],
  },
];
const flat = groups.flatMap((g) => g.links);

function isActive(pathname: string, href: string, exact?: boolean) {
  return exact
    ? pathname === href
    : pathname === href || pathname.startsWith(`${href}/`);
}

function LagosClock() {
  const [now, setNow] = useState<string | null>(null);
  useEffect(() => {
    const format = () =>
      new Intl.DateTimeFormat('en-NG', {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Africa/Lagos',
      }).format(new Date());
    // The clock is browser-only; rendering it on the server would mismatch.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNow(format());
    const timer = setInterval(() => setNow(format()), 30000);
    return () => clearInterval(timer);
  }, []);
  return now ? (
    <span className="icon-line num">
      <span
        className="swatch"
        aria-hidden
        style={{
          width: 7,
          height: 7,
          borderRadius: 9,
          background: 'var(--color-series-paid)',
        }}
      />
      {now} WAT
    </span>
  ) : null;
}

export function DashShell({
  crumbs,
  business,
  children,
}: {
  crumbs: { label: string; href?: string }[];
  business?: string;
  children: ReactNode;
}) {
  const pathname = usePathname();
  return (
    <div className="dash">
      <aside className="dash-side">
        <Brand />
        {business && (
          <div className="dash-business">
            <strong style={{ color: 'var(--color-ink)', fontWeight: 600 }}>
              {business}
            </strong>
            Business account
          </div>
        )}
        <nav aria-label="Business" className="grid gap-5">
          {groups.map((group) => (
            <div key={group.title} className="dash-group">
              <p>{group.title}</p>
              {group.links.map(({ href, label, icon: Icon, ...rest }) => (
                <Link
                  key={href}
                  href={href}
                  aria-current={
                    isActive(pathname, href, 'exact' in rest)
                      ? 'page'
                      : undefined
                  }
                >
                  <Icon size={18} aria-hidden /> {label}
                </Link>
              ))}
            </div>
          ))}
        </nav>
        <div className="dash-foot dash-group">
          <Link href="/offers">
            <ArrowLeftRight size={18} aria-hidden /> Switch to shopper app
          </Link>
        </div>
      </aside>
      <div className="dash-body">
        <header className="dash-top">
          <nav aria-label="Breadcrumb" className="crumbs">
            {crumbs.map((crumb, i) => (
              <span key={crumb.label} className="icon-line">
                {i > 0 && <span aria-hidden>/</span>}
                {crumb.href && i < crumbs.length - 1 ? (
                  <Link href={crumb.href}>{crumb.label}</Link>
                ) : (
                  <span
                    aria-current={i === crumbs.length - 1 ? 'page' : undefined}
                    className="truncate"
                  >
                    {crumb.label}
                  </span>
                )}
              </span>
            ))}
          </nav>
          <LagosClock />
        </header>
        <nav className="dash-tabs" aria-label="Business sections">
          {flat.map(({ href, label, ...rest }) => (
            <Link
              key={href}
              href={href}
              aria-current={
                isActive(pathname, href, 'exact' in rest) ? 'page' : undefined
              }
            >
              {label}
            </Link>
          ))}
          <Link href="/offers">Shopper app</Link>
        </nav>
        <main id="main-content" className="dash-main">
          {children}
        </main>
      </div>
    </div>
  );
}

export function DashHead({
  title,
  intro,
  actions,
}: {
  title: string;
  intro?: string;
  actions?: ReactNode;
}) {
  return (
    <div
      className="row"
      style={{
        alignItems: 'flex-end',
        flexWrap: 'wrap',
        marginBottom: '1.5rem',
      }}
    >
      <div className="page-head" style={{ margin: 0 }}>
        <h1 style={{ fontSize: 'clamp(1.6rem, 4vw, 2rem)' }}>{title}</h1>
        {intro && <p>{intro}</p>}
      </div>
      {actions}
    </div>
  );
}
