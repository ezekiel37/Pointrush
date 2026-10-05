'use client';
import Link from 'next/link';
import { useEffect, useRef } from 'react';
import {
  BadgeCheck,
  Bell,
  CircleSlash,
  Landmark,
  RotateCcw,
  Wallet,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { z } from 'zod';
import { Page } from '@/components/shell/app-shell';
import { Loading } from '@/components/ui/feedback';
import { WorkFailure } from '@/components/work/work-frame';
import { apiRequest, shortDate } from '@/lib/api';
import { notificationFeed } from '@/lib/rewards';
import { useApiRead } from '@/lib/use-api-read';

// One icon per kind, so the feed can be scanned without reading every line.
const kindIcon: Record<string, LucideIcon> = {
  cashback_ready: Wallet,
  cashback_voided: CircleSlash,
  withdrawal_paid: Landmark,
  withdrawal_failed: RotateCcw,
  review_approved: BadgeCheck,
  review_changes_required: Bell,
  review_rejected: CircleSlash,
  funding_confirmed: Landmark,
  campaign_return: RotateCcw,
};

export function Notifications() {
  const feed = useApiRead('notifications', notificationFeed);
  const marked = useRef(false);
  // Opening the page marks everything read; unread dots stay for this visit.
  useEffect(() => {
    if (!feed.data || marked.current || !feed.data.unread) return;
    marked.current = true;
    void apiRequest('notifications/seen', z.unknown(), {
      method: 'POST',
      body: {},
    }).catch(() => {
      marked.current = false;
    });
  }, [feed.data]);
  return (
    <Page eyebrow="Updates" title="Notifications">
      {feed.loading && !feed.data ? (
        <Loading>Loading notifications…</Loading>
      ) : feed.error && !feed.data ? (
        <WorkFailure error={feed.error} retry={feed.refresh} />
      ) : feed.data?.items.length ? (
        <ul className="stack" style={{ maxWidth: 640 }}>
          {feed.data.items.map((item) => (
            <li key={item.id}>
              <Link
                href={item.href}
                className={`card notice${item.unread ? ' notice-unread' : ''}`}
              >
                <span className="notice-icon" aria-hidden>
                  {(() => {
                    const Icon = kindIcon[item.kind] ?? Bell;
                    return <Icon size={18} />;
                  })()}
                  {item.unread && <span className="notice-dot" />}
                </span>
                <span style={{ minWidth: 0 }}>
                  <span className="notice-title">
                    {item.unread && <span className="sr-only">New: </span>}
                    {item.title}
                  </span>
                  {item.body && (
                    <span className="small-note notice-body">{item.body}</span>
                  )}
                  <span className="small-note num">{shortDate(item.at)}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="small-note">
          Nothing yet. Cash back, prizes, withdrawals and campaign reviews
          appear here.
        </p>
      )}
    </Page>
  );
}
