'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { getAccount } from '@/lib/account';

// Signed-out visitors see Sign in and Get started; someone already signed
// in gets one way back into the app instead.
export function AccountLinks() {
  const [signedIn, setSignedIn] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    getAccount(controller.signal).then(
      () => setSignedIn(true),
      () => undefined,
    );
    return () => controller.abort();
  }, []);
  return signedIn ? (
    <Link className="button button-primary" href="/account?home=1">
      Open app
    </Link>
  ) : (
    <>
      <Link className="button button-outline hide-narrow" href="/login">
        Sign in
      </Link>
      <Link className="button button-primary" href="/signup">
        Get started
      </Link>
    </>
  );
}
