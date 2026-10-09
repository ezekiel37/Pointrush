'use client';
import Link from 'next/link';
import { useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Copy, Lightbulb, Phone, Tv, Wifi } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Page } from '@/components/shell/app-shell';
import { Button } from '@/components/ui/button';
import { Celebrate } from '@/components/ui/celebrate';
import { Feedback, Loading } from '@/components/ui/feedback';
import { Field } from '@/components/ui/field';
import { WorkFailure } from '@/components/work/work-frame';
import { apiRequest, naira, newId, shortDate, toKobo } from '@/lib/api';
import { RequestError } from '@/lib/auth-client';
import {
  billCustomer,
  billOptions,
  billPage,
  billPurchase,
  kindLabel,
  refLabel,
} from '@/lib/bills';
import type { BillKind, BillPurchase } from '@/lib/bills';
import { pointsSummary } from '@/lib/rewards';
import { useApiRead } from '@/lib/use-api-read';

const kindIcon: Record<BillKind, LucideIcon> = {
  airtime: Phone,
  data: Wifi,
  electricity: Lightbulb,
  tv: Tv,
};
const stateChip = {
  pending: ['Processing', 'chip chip-pending'],
  delivered: ['Done', 'chip chip-done'],
  failed: ['Refunded to wallet', 'chip chip-muted'],
} as const;

function payError(error: unknown) {
  if (error instanceof RequestError) {
    switch (error.code) {
      case 'password_required':
        return 'That password is not right. Enter the password you sign in with.';
      case 'insufficient_balance':
        return 'That is more than your wallet balance.';
      case 'bill_daily_limit':
        return 'You can spend up to ₦50,000 a day on bills, in up to 10 payments. Try again tomorrow.';
      case 'bill_unavailable':
        return 'Paying bills needs a verified phone number. Verify it from your wallet.';
      case 'withdrawals_locked':
        return 'Your wallet is locked while support checks your account.';
      case 'plan_changed':
        return 'That plan or price changed. Choose it again.';
      case 'invalid_phone':
        return 'Enter an 11-digit phone number, for example 08031234567.';
      case 'amount_out_of_range':
        return 'Enter an amount between ₦50 and ₦50,000.';
      case 'bills_unavailable':
        return 'Bill payments are not available yet.';
    }
  }
  return 'We could not confirm the payment. Check your connection and try again; you will never be charged twice.';
}

export function Bills({ initialKind = 'airtime' }: { initialKind?: BillKind }) {
  const options = useApiRead('wallet/bills/options', billOptions);
  const summary = useApiRead('points', pointsSummary);
  const history = useApiRead('wallet/bills?limit=10', billPage);
  const [kind, setKind] = useState<BillKind>(initialKind);
  const [result, setResult] = useState<BillPurchase | null>(null);

  const loading =
    (options.loading && !options.data) || (summary.loading && !summary.data);
  const failure = options.error ?? summary.error;
  return (
    <Page
      eyebrow="Wallet"
      title="Airtime, data and bills"
      intro="Spend your rewards instantly. No minimum and no bank transfer."
    >
      {loading ? (
        <Loading>Loading…</Loading>
      ) : failure && !(options.data && summary.data) ? (
        <WorkFailure
          error={failure}
          retry={() => {
            options.refresh();
            summary.refresh();
          }}
        />
      ) : (
        options.data &&
        summary.data && (
          <div className="grid gap-6 bills">
            {!options.data.available ? (
              <section className="card grid gap-3">
                <h2 style={{ margin: 0 }}>Coming soon</h2>
                <p className="small-note" style={{ margin: 0 }}>
                  Soon you can turn your rewards into airtime, data, electricity
                  and TV subscriptions. Your balance is safe in your wallet
                  until then.
                </p>
                <Link className="text-link" href="/wallet">
                  Back to wallet
                </Link>
              </section>
            ) : !summary.data.phoneVerified ? (
              <section className="card grid gap-3">
                <h2 style={{ margin: 0 }}>Verify your phone first</h2>
                <p className="small-note" style={{ margin: 0 }}>
                  Like withdrawing, paying bills needs a verified phone number.
                  It keeps your money safe if someone else gets into your
                  account.
                </p>
                <Link
                  className="button button-primary"
                  href="/verify-phone?next=/wallet/bills"
                  style={{ justifySelf: 'start' }}
                >
                  Verify your phone
                </Link>
              </section>
            ) : result ? (
              <Receipt
                purchase={result}
                billerName={
                  options.data.billers.find((b) => b.id === result.biller)
                    ?.name ?? result.biller
                }
                onAgain={() => setResult(null)}
              />
            ) : (
              <>
                <p className="bills-balance">
                  <span className="small-note">In your wallet</span>
                  <span className="amount">
                    {naira(summary.data.walletKobo)}
                  </span>
                </p>
                <div
                  className="segmented preset-row bills-kinds"
                  role="group"
                  aria-label="What to pay for"
                >
                  {(Object.keys(kindLabel) as BillKind[]).map((k) => {
                    const Icon = kindIcon[k];
                    return (
                      <button
                        key={k}
                        type="button"
                        aria-pressed={kind === k}
                        onClick={() => setKind(k)}
                      >
                        <Icon size={16} aria-hidden /> {kindLabel[k]}
                      </button>
                    );
                  })}
                </div>
                <BillForm
                  key={kind}
                  kind={kind}
                  billers={options.data.billers.filter((b) => b.kind === kind)}
                  walletKobo={summary.data.walletKobo}
                  onDone={(purchase) => {
                    setResult(purchase);
                    summary.refresh();
                    history.refresh();
                  }}
                />
              </>
            )}
            {history.data && history.data.items.length > 0 && (
              <section aria-labelledby="bills-history">
                <h2 id="bills-history" className="section-title">
                  Recent payments
                </h2>
                <ul className="bills-history">
                  {history.data.items.map((item) => {
                    const Icon = kindIcon[item.kind];
                    const [label, chip] = stateChip[item.state];
                    return (
                      <li key={item.id}>
                        <Icon size={18} aria-hidden />
                        <span>
                          <strong>
                            {kindLabel[item.kind]} ·{' '}
                            {options.data!.billers.find(
                              (b) => b.id === item.biller,
                            )?.name ?? item.biller}
                          </strong>
                          <span className="small-note">
                            {item.customerRef} ·{' '}
                            {shortDate(item.createdAt.toISOString())}
                            {item.token ? ` · Token ${item.token}` : ''}
                          </span>
                        </span>
                        <span className="bills-history-end">
                          <span className="num">{naira(item.amountKobo)}</span>
                          <span className={chip}>{label}</span>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}
          </div>
        )
      )}
    </Page>
  );
}

type Biller = {
  id: string;
  name: string;
  plans: { code: string; name: string; amountKobo: string }[] | null;
};

function BillForm({
  kind,
  billers,
  walletKobo,
  onDone,
}: {
  kind: BillKind;
  billers: Biller[];
  walletKobo: string;
  onDone: (purchase: BillPurchase) => void;
}) {
  const [billerId, setBillerId] = useState(billers[0]?.id ?? '');
  const [ref, setRef] = useState('');
  const [planCode, setPlanCode] = useState('');
  const [amount, setAmount] = useState('');
  const [customer, setCustomer] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // A lost response keeps the same ID, so paying again never charges twice.
  const attempt = useRef<{ key: string; id: string } | null>(null);

  const biller = billers.find((b) => b.id === billerId);
  const plan = biller?.plans?.find((p) => p.code === planCode);
  const digits = ref.replace(/[\s-]/g, '');
  const amountKobo = biller?.plans
    ? (plan?.amountKobo ?? null)
    : toKobo(amount);
  const needsCheck = kind === 'electricity' || kind === 'tv';

  function reset() {
    setCustomer(null);
    setReviewing(false);
    setError('');
  }

  function validate() {
    const next: Record<string, string> = {};
    if (!biller) next.biller = 'Choose who to pay.';
    if (kind === 'airtime' || kind === 'data') {
      if (!/^0[789][01]\d{8}$/.test(digits))
        next.ref = 'Enter an 11-digit phone number, for example 08031234567.';
    } else if (!/^\d{10,13}$/.test(digits))
      next.ref = `Enter the ${refLabel[kind].toLowerCase()}.`;
    if (biller?.plans && !plan) next.plan = 'Choose a plan.';
    if (!biller?.plans) {
      if (
        !amountKobo ||
        BigInt(amountKobo) < 5000n ||
        BigInt(amountKobo) > 5000000n
      )
        next.amount = 'Enter an amount between ₦50 and ₦50,000.';
    }
    if (amountKobo && BigInt(amountKobo) > BigInt(walletKobo))
      next.amount = `You have ${naira(walletKobo)} in your wallet.`;
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function review(event: FormEvent) {
    event.preventDefault();
    if (busy || !validate()) return;
    setError('');
    if (needsCheck) {
      setBusy(true);
      try {
        const found = await apiRequest('wallet/bills/verify', billCustomer, {
          method: 'POST',
          body: { kind, biller: billerId, customerRef: digits },
        });
        setCustomer(found.name);
      } catch {
        setErrors({
          ref: `We could not find this ${refLabel[kind].toLowerCase()}. Check it and try again.`,
        });
        setBusy(false);
        return;
      }
      setBusy(false);
    }
    setReviewing(true);
  }

  async function pay(event: FormEvent) {
    event.preventDefault();
    if (busy || !amountKobo) return;
    if (!password) {
      setError('Enter your password to confirm it is you.');
      return;
    }
    const body = {
      kind,
      biller: billerId,
      customerRef: digits,
      ...(plan ? { planCode: plan.code } : {}),
      amountKobo,
    };
    const key = JSON.stringify(body);
    if (attempt.current?.key !== key) attempt.current = { key, id: newId() };
    setBusy(true);
    setError('');
    try {
      const purchase = await apiRequest('wallet/bills', billPurchase, {
        method: 'POST',
        body: { ...body, id: attempt.current.id, password },
      });
      attempt.current = null;
      onDone(purchase);
    } catch (cause) {
      if (cause instanceof RequestError && cause.status < 500)
        attempt.current = null;
      if (cause instanceof RequestError && cause.code === 'password_required')
        setPassword('');
      setError(payError(cause));
    } finally {
      setBusy(false);
    }
  }

  if (reviewing && biller && amountKobo)
    return (
      <form
        className="card grid gap-4"
        onSubmit={pay}
        noValidate
        aria-labelledby="bill-review"
      >
        <h2 id="bill-review" style={{ margin: 0 }}>
          Check and pay
        </h2>
        <dl className="bill-review">
          <div>
            <dt>{kindLabel[kind]}</dt>
            <dd>
              {biller.name}
              {plan ? ` · ${plan.name}` : ''}
            </dd>
          </div>
          <div>
            <dt>{refLabel[kind]}</dt>
            <dd className="num">{digits}</dd>
          </div>
          {customer && (
            <div>
              <dt>Name on account</dt>
              <dd>{customer}</dd>
            </div>
          )}
          <div>
            <dt>From your wallet</dt>
            <dd className="amount">{naira(amountKobo)}</dd>
          </div>
        </dl>
        <Field
          id="bill-password"
          label="Your password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          hint="Needed for every payment, so nobody else can spend your rewards."
        />
        {error && <Feedback error>{error}</Feedback>}
        <div className="flex gap-2" style={{ flexWrap: 'wrap' }}>
          <Button type="submit" loading={busy}>
            {busy ? 'Paying…' : `Pay ${naira(amountKobo)}`}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={reset}
            disabled={busy}
          >
            Change details
          </Button>
        </div>
      </form>
    );

  return (
    <form
      className="card grid gap-4"
      onSubmit={review}
      noValidate
      aria-label={`Buy ${kindLabel[kind].toLowerCase()}`}
    >
      <div className="field">
        <span className="field-label" id="biller-label">
          {kind === 'airtime' || kind === 'data' ? 'Network' : 'Provider'}
        </span>
        <div className="bill-chips" role="group" aria-labelledby="biller-label">
          {billers.map((b) => (
            <button
              key={b.id}
              type="button"
              aria-pressed={billerId === b.id}
              onClick={() => {
                setBillerId(b.id);
                setPlanCode('');
                reset();
              }}
            >
              {b.name}
            </button>
          ))}
        </div>
        {errors.biller && (
          <p className="field-help field-error">{errors.biller}</p>
        )}
      </div>
      <Field
        id="bill-ref"
        label={refLabel[kind]}
        inputMode="numeric"
        autoComplete={
          kind === 'airtime' || kind === 'data' ? 'tel-national' : 'off'
        }
        placeholder={kind === 'airtime' || kind === 'data' ? '08031234567' : ''}
        value={ref}
        onChange={(e) => {
          setRef(e.target.value);
          setErrors((x) => ({ ...x, ref: '' }));
          reset();
        }}
        error={errors.ref}
      />
      {biller?.plans ? (
        <div className="field">
          <span className="field-label" id="plan-label">
            {kind === 'tv' ? 'Package' : 'Bundle'}
          </span>
          <div className="bill-plans" role="group" aria-labelledby="plan-label">
            {biller.plans.map((p) => (
              <button
                key={p.code}
                type="button"
                aria-pressed={planCode === p.code}
                onClick={() => {
                  setPlanCode(p.code);
                  setErrors((x) => ({ ...x, plan: '' }));
                }}
              >
                <span>{p.name}</span>
                <span className="num">{naira(p.amountKobo)}</span>
              </button>
            ))}
          </div>
          {errors.plan && (
            <p className="field-help field-error">{errors.plan}</p>
          )}
          {errors.amount && (
            <p className="field-help field-error">{errors.amount}</p>
          )}
        </div>
      ) : (
        <Field
          id="bill-amount"
          label="Amount in naira"
          inputMode="decimal"
          autoComplete="off"
          placeholder={kind === 'airtime' ? '500' : '5,000'}
          value={amount}
          onChange={(e) => {
            setAmount(e.target.value);
            setErrors((x) => ({ ...x, amount: '' }));
          }}
          hint="From ₦50 to ₦50,000."
          error={errors.amount}
        />
      )}
      <Button type="submit" loading={busy} style={{ justifySelf: 'start' }}>
        {needsCheck ? (busy ? 'Checking…' : 'Check number') : 'Continue'}
      </Button>
    </form>
  );
}

function Receipt({
  purchase,
  billerName,
  onAgain,
}: {
  purchase: BillPurchase;
  billerName: string;
  onAgain: () => void;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <section className="card grid gap-3 bill-receipt" aria-live="polite">
      {purchase.state === 'delivered' && <Celebrate size={56} />}
      <h2 style={{ margin: 0 }}>
        {purchase.state === 'delivered'
          ? 'Done'
          : purchase.state === 'failed'
            ? 'Payment failed, money returned'
            : 'Processing'}
      </h2>
      <p className="small-note" style={{ margin: 0 }}>
        {purchase.state === 'delivered'
          ? `${naira(purchase.amountKobo)} of ${kindLabel[purchase.kind].toLowerCase()} for ${purchase.customerRef} (${billerName}).`
          : purchase.state === 'failed'
            ? `${purchase.failure ?? 'The provider declined it.'} The ${naira(purchase.amountKobo)} is back in your wallet.`
            : 'The provider has not confirmed it yet. The money is held, and comes back to your wallet if it fails.'}
      </p>
      {purchase.token && (
        <div className="bill-token">
          <span className="small-note">Your meter token</span>
          <strong className="num">{purchase.token}</strong>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              void navigator.clipboard?.writeText(purchase.token!).then(
                () => setCopied(true),
                () => setCopied(false),
              );
            }}
          >
            <Copy size={16} aria-hidden /> {copied ? 'Copied' : 'Copy token'}
          </Button>
        </div>
      )}
      <div className="flex gap-2" style={{ flexWrap: 'wrap' }}>
        <Button type="button" onClick={onAgain}>
          Pay another
        </Button>
        <Link className="button button-outline" href="/wallet">
          Back to wallet
        </Link>
      </div>
    </section>
  );
}
