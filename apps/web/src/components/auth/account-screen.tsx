'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, LogOut } from 'lucide-react';
import { AuthFrame, Brand } from './auth-frame';
import { OnboardingForm } from './onboarding-form';
import { Button } from '@/components/ui/button';
import { Feedback, Loading } from '@/components/ui/feedback';
import { getAccount } from '@/lib/account';
import type { AccountStatus } from '@/lib/account';
import {
  authClient,
  errorMessage,
  RequestError,
  requireSuccess,
} from '@/lib/auth-client';
import { useSubmit } from '@/lib/use-submit';
export function AccountScreen() {
  const router = useRouter();
  const [status, setStatus] = useState<AccountStatus | null>(null);
  const [error, setError] = useState('');
  const [expired, setExpired] = useState(false);
  const [loading, setLoading] = useState(true);
  const active = useRef<AbortController | null>(null);
  const initialized = useRef(false);
  const logout = useSubmit();
  const refresh = useCallback(async () => {
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    try {
      const current = await getAccount(controller.signal);
      if (controller.signal.aborted) return;
      initialized.current = true;
      setStatus(current);
      setError('');
      setExpired(false);
    } catch (cause) {
      if (controller.signal.aborted) return;
      if (cause instanceof RequestError && cause.status === 401) {
        setExpired(true);
        if (!initialized.current) {
          router.replace('/login');
          return;
        }
      }
      setError(errorMessage(cause));
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [router]);
  useEffect(() => {
    // This effect synchronizes external API state; updates follow the bounded request.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
    const visible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    const online = () => {
      setLoading(true);
      void refresh();
    };
    window.addEventListener('online', online);
    document.addEventListener('visibilitychange', visible);
    return () => {
      active.current?.abort();
      window.removeEventListener('online', online);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [refresh]);
  const signOut = () =>
    logout.run(async () => {
      requireSuccess(await authClient().signOut());
      active.current?.abort();
      setStatus(null);
      router.replace('/login');
    });
  const errorPanel = error && (
    <>
      <Feedback error>
        {expired ? 'Your session has ended. Sign in again to continue.' : error}
      </Feedback>
      <div className="flex flex-wrap gap-3">
        <Button
          variant="outline"
          disabled={loading}
          onClick={() => void refresh()}
        >
          {loading ? 'Checking…' : 'Check again'}
        </Button>
        <Link
          className="text-link"
          href={expired ? '/login' : '/verify-email'}
          target={status?.onboarding === 'required' ? '_blank' : undefined}
          rel="noopener"
        >
          {expired ? 'Sign in again' : 'Verify email'}
        </Link>
      </div>
    </>
  );
  if (!status)
    return (
      <AuthFrame
        title="Your account"
        description="Checking your account and setup status."
      >
        {errorPanel || <Loading />}
      </AuthFrame>
    );
  if (status.onboarding === 'required')
    return (
      <AuthFrame
        title="Make it yours"
        description="Choose the name people will see and your unique username."
        step={3}
      >
        {errorPanel}
        <OnboardingForm onSaved={refresh} blocked={Boolean(error)} />
        <Button variant="ghost" onClick={signOut} disabled={logout.busy}>
          Sign out
        </Button>
        {logout.error && <Feedback error>{logout.error}</Feedback>}
      </AuthFrame>
    );
  const { account } = status;
  return (
    <>
      <header className="account-header">
        <Brand />
        <nav aria-label="Account navigation">
          <Link href="/help">Help</Link>
          <Button variant="ghost" disabled={logout.busy} onClick={signOut}>
            <LogOut size={18} aria-hidden />
            {logout.busy ? 'Signing out…' : 'Sign out'}
          </Button>
        </nav>
      </header>
      <main id="main-content" className="account-content">
        {logout.error && <Feedback error>{logout.error}</Feedback>}
        {errorPanel || (
          <>
            <div className="account-welcome">
              <div>
                <p className="eyebrow">Your starting point</p>
                <h1>Hello, {account.displayName}.</h1>
                <p>Your PointRush profile is set up.</p>
              </div>
              <span className="badge">
                <Check size={16} aria-hidden />
                Email verified
              </span>
            </div>
            {account.accessState !== 'active' ? (
              <section className="account-panel">
                <h2>Account {account.accessState}</h2>
                <p>
                  Your account is currently {account.accessState}. Task and
                  reward actions are unavailable. This status does not change
                  any previously recorded earnings.
                </p>
                <Link className="text-link" href="/help">
                  Read account help
                </Link>
              </section>
            ) : (
              <div className="account-grid">
                <section className="account-panel">
                  <p className="eyebrow">What comes next</p>
                  <h2>You’re ready for the next step.</h2>
                  <p>
                    Tasks and rewards are not available yet. When they open,
                    each opportunity will explain what to do, who is eligible
                    and how rewards are approved.
                  </p>
                  <Link className="text-link" href="/help">
                    Understand how PointRush works
                  </Link>
                </section>
                <section className="account-panel">
                  <h2>Your profile</h2>
                  <dl>
                    <div>
                      <dt>Username</dt>
                      <dd>@{account.username}</dd>
                    </div>
                    <div>
                      <dt>Account status</dt>
                      <dd>Active</dd>
                    </div>
                    <div>
                      <dt>Reputation</dt>
                      <dd>New</dd>
                    </div>
                  </dl>
                  <p className="small-note mt-5">
                    Email verification confirms email ownership. It is not an
                    identity verification badge.
                  </p>
                </section>
                <section className="account-panel security-panel">
                  <p className="eyebrow">Reviewer security</p>
                  <h2>Use an authenticator app</h2>
                  <p>
                    Appointed reviewers need a recent authenticator check before
                    sensitive review actions. Basic accounts can leave this
                    unavailable.
                  </p>
                  <Link className="text-link" href="/two-factor?mode=enroll">
                    Set up authenticator security
                  </Link>
                </section>
              </div>
            )}
          </>
        )}
      </main>
    </>
  );
}
