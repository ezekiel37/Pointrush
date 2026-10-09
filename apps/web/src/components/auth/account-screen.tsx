'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, LogOut } from 'lucide-react';
import { AuthFrame, Brand } from './auth-frame';
import { OnboardingForm } from './onboarding-form';
import { IdentityPanel } from './identity-panel';
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
import { homePath } from '@/lib/role';
export function AccountScreen({ goHome = false }: { goHome?: boolean }) {
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
        <OnboardingForm
          onSaved={refresh}
          blocked={Boolean(error)}
          invitedBy={status.invitedBy}
        />
        <Button variant="ghost" onClick={signOut} loading={logout.busy}>
          Sign out
        </Button>
        {logout.error && <Feedback error>{logout.error}</Feedback>}
      </AuthFrame>
    );
  const { account } = status;
  // A set-up, active account goes straight to its home: the business
  // dashboard, the staff tills or the earner app.
  if (goHome && account.accessState === 'active' && !error)
    return <GoHome accountType={status.accountType} />;
  return (
    <>
      <header className="account-header">
        <Brand />
        <nav aria-label="Account navigation">
          <Link href="/help">Help</Link>
          <Button variant="ghost" loading={logout.busy} onClick={signOut}>
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
                <p>Your Acticlaim profile is set up.</p>
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
                    Find cash back offers near you, or claim a prize code from a
                    pack. What you earn goes to your wallet.
                  </p>
                  <Link className="button button-outline" href="/offers">
                    See offers
                  </Link>
                </section>
                <IdentityPanel
                  displayName={account.displayName}
                  username={account.username}
                  onSaved={() => void refresh()}
                />
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
                  <Link className="text-link" href="/review/appeals">
                    Review appeals (appointed reviewers)
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

function GoHome({ accountType }: { accountType: 'personal' | 'business' }) {
  const router = useRouter();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    homePath(accountType).then(
      (path) => live && router.replace(path),
      () => live && setFailed(true),
    );
    return () => {
      live = false;
    };
  }, [router, accountType]);
  return (
    <AuthFrame title="Welcome back" description="Taking you in…">
      {failed ? (
        <Feedback error>
          We could not load your account. Check your connection, or go to{' '}
          <Link href="/offers">offers</Link>.
        </Feedback>
      ) : (
        <Loading>Taking you in…</Loading>
      )}
    </AuthFrame>
  );
}
