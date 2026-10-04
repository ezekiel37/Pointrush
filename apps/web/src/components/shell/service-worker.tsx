'use client';
import { useEffect } from 'react';
// Registers the offline shell. Production only: development rebuilds would be
// masked by cached assets.
export function ServiceWorker() {
  useEffect(() => {
    if (
      process.env.NODE_ENV !== 'production' ||
      !('serviceWorker' in navigator)
    )
      return;
    void navigator.serviceWorker
      .register('/sw.js', { scope: '/', updateViaCache: 'none' })
      .catch(() => undefined);
  }, []);
  return null;
}
