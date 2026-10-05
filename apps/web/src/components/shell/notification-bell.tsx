'use client';
import Link from 'next/link';
import { Bell } from 'lucide-react';
import { notificationFeed } from '@/lib/rewards';
import { useApiRead } from '@/lib/use-api-read';

// Shown only to signed-in people; anything else (signed out, offline) hides it.
export function NotificationBell() {
  const feed = useApiRead('notifications', notificationFeed);
  if (!feed.data) return null;
  const count = feed.data.unread;
  return (
    <Link
      href="/notifications"
      className="bell"
      aria-label={
        count ? `Notifications, ${count} unread` : 'Notifications, none unread'
      }
    >
      <Bell size={19} aria-hidden />
      {count > 0 && (
        <span className="bell-count" aria-hidden>
          {count > 9 ? '9+' : count}
        </span>
      )}
    </Link>
  );
}
