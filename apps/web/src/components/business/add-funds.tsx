'use client';
import { useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { LockKeyhole } from 'lucide-react';
import { DashHead, DashShell } from './dash-shell';
import { NoBusiness } from './business-home';
import { Button } from '@/components/ui/button';
import { Feedback, Loading } from '@/components/ui/feedback';
import { Field } from '@/components/ui/field';
import { WorkFailure } from '@/components/work/work-frame';
import { apiRequest, naira, newId, toKobo } from '@/lib/api';
import { RequestError } from '@/lib/auth-client';
import { businessOverview, fundingIntent } from '@/lib/rewards';
import { useApiRead } from '@/lib/use-api-read';

const presets = ['5000000', '10000000', '25000000', '50000000'];
const minKobo = 100000n;
const maxKobo = 10000000000n;

function fundingError(error: unknown) {
  if (error instanceof RequestError) {
    if (error.code === 'payments_unavailable')
      return 'Payments are not live yet. No money has moved, and nothing will be charged.';
    if (error.code === 'checkout_started')
      return 'A checkout for this request already started. Press continue again to start a fresh one.';
    if (error.status === 400)
      return 'Enter an amount between ₦1,000 and ₦100,000,000.';
  }
  return 'We could not reach the payment page. Check your connection and try again; you will not be charged twice.';
}

export function AddFunds() {
  const overview = useApiRead('business/overview?days=7', businessOverview);
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [invalid, setInvalid] = useState('');
  // A lost response keeps the same ID, so trying again cannot open a second
  // funding request for the same amount.
  const attempt = useRef<{ id: string; amountKobo: string } | null>(null);
  const kobo = toKobo(amount);
  const missing =
    overview.error instanceof RequestError && overview.error.status === 404;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (!kobo || BigInt(kobo) < minKobo || BigInt(kobo) > maxKobo) {
      setInvalid('Enter an amount between ₦1,000 and ₦100,000,000.');
      return;
    }
    setInvalid('');
    if (attempt.current?.amountKobo !== kobo)
      attempt.current = { id: newId(), amountKobo: kobo };
    setBusy(true);
    setError('');
    try {
      const result = await apiRequest(
        'payments/funding-intents',
        fundingIntent,
        {
          method: 'POST',
          body: attempt.current,
        },
      );
      // Money is credited only when the provider confirms, never on return.
      window.location.assign(result.checkoutUrl);
    } catch (cause) {
      if (cause instanceof RequestError && cause.status < 500)
        attempt.current = null;
      setError(fundingError(cause));
      setBusy(false);
    }
  }

  const data = overview.data;
  return (
    <DashShell
      crumbs={[
        { label: 'Business', href: '/business' },
        { label: 'Add funds' },
      ]}
      business={data?.business.name}
    >
      <DashHead
        title="Add funds"
        intro="Top up once, then lock money into cash back offers and prize promotions."
      />
      {overview.loading && !data ? (
        <Loading>Loading your balance…</Loading>
      ) : missing ? (
        <NoBusiness />
      ) : overview.error && !data ? (
        <WorkFailure error={overview.error} retry={overview.refresh} />
      ) : (
        data && (
          <div className="dash-grid">
            <section className="card grid gap-5" aria-labelledby="fund-heading">
              <dl className="balance-pair">
                <div>
                  <dt>Available to spend</dt>
                  <dd className="amount">{naira(data.availableKobo)}</dd>
                </div>
                <div>
                  <dt>Locked in campaigns</dt>
                  <dd className="amount">{naira(data.lockedKobo)}</dd>
                </div>
              </dl>
              <form className="grid gap-4" onSubmit={submit} noValidate>
                <h2 id="fund-heading" style={{ margin: 0 }}>
                  How much?
                </h2>
                <div
                  className="segmented preset-row"
                  role="group"
                  aria-label="Suggested amounts"
                >
                  {presets.map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      aria-pressed={kobo === preset}
                      onClick={() => {
                        setAmount(
                          (BigInt(preset) / 100n).toLocaleString('en-NG'),
                        );
                        setInvalid('');
                      }}
                    >
                      {naira(preset)}
                    </button>
                  ))}
                </div>
                <Field
                  id="fund-amount"
                  label="Amount in naira"
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder="100,000"
                  value={amount}
                  onChange={(e) => {
                    setAmount(e.target.value);
                    setInvalid('');
                  }}
                  hint="Minimum ₦1,000. You pay by bank transfer on the next page."
                  error={invalid}
                />
                {error && <Feedback error>{error}</Feedback>}
                <Button
                  variant="accent"
                  type="submit"
                  disabled={busy}
                  className="full-width"
                >
                  {busy
                    ? 'Opening secure checkout…'
                    : kobo
                      ? `Continue to pay ${naira(kobo)}`
                      : 'Continue to secure checkout'}
                </Button>
                <p className="small-note icon-line">
                  <LockKeyhole size={15} aria-hidden /> You pay on the payment
                  provider&apos;s page by bank transfer. Card payments are not
                  accepted for funding.
                </p>
              </form>
            </section>
            <section className="card" aria-labelledby="how-heading">
              <div className="card-head">
                <h2 id="how-heading">How your money is handled</h2>
              </div>
              <ol className="timeline">
                <li>
                  <strong>You pay the provider.</strong>
                  <span>
                    The amount goes to your Acticlaim balance, not to a campaign
                    yet.
                  </span>
                </li>
                <li>
                  <strong>We wait for confirmation.</strong>
                  <span>
                    Your balance rises only when the provider confirms the exact
                    amount. Coming back from the payment page is not enough.
                  </span>
                </li>
                <li>
                  <strong>You lock it into a campaign.</strong>
                  <span>
                    Locked money pays shoppers and winners. Customers can see
                    the money is there before they buy.
                  </span>
                </li>
              </ol>
            </section>
          </div>
        )
      )}
    </DashShell>
  );
}
