'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { z } from 'zod';
import { DashHead, DashShell } from './dash-shell';
import { NoBusiness } from './business-home';
import { Button } from '@/components/ui/button';
import { Feedback, Loading } from '@/components/ui/feedback';
import { Field } from '@/components/ui/field';
import { WorkFailure } from '@/components/work/work-frame';
import { apiRequest, naira, newId, toKobo } from '@/lib/api';
import { RequestError } from '@/lib/auth-client';
import { businessOverview } from '@/lib/rewards';
import { useApiRead } from '@/lib/use-api-read';

type Model = 'purchase_cashback' | 'claim_code';
const created = z.object({ id: z.uuid() });
const holdChoices = [
  [24, '1 day'],
  [72, '3 days'],
  [168, '7 days'],
  [336, '14 days'],
] as const;

// datetime-local works in the browser's own time zone, without seconds.
function localInput(date: Date) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
const inFuture = (date: Date) => date.getTime() > Date.now();
function defaultStart() {
  const d = new Date(Date.now() + 2 * 3600000);
  d.setMinutes(0, 0, 0);
  return d;
}

const copy = {
  purchase_cashback: {
    title: 'New cash back offer',
    intro:
      'Pay shoppers back for purchases you confirm at your till. The full amount is locked now and reviewed before it goes live.',
    list: '/business/campaigns',
    listLabel: 'Cash back',
    reward: 'Cash back per purchase',
    capacity: 'Number of shoppers',
    titleHint: 'For example: ₦500 back on any lunch',
    instructionsLabel: 'What shoppers do',
    instructionsHint:
      'For example: Buy any meal and show your Acticlaim code at the counter.',
  },
  claim_code: {
    title: 'New prize promotion',
    intro:
      'Hide codes in packs, receipts or scratch cards. Acticlaim verifies each claim once and pays the prize from money you lock now.',
    list: '/business/promotions',
    listLabel: 'Prize promotions',
    reward: 'Prize per winning code',
    capacity: 'Number of prizes',
    titleHint: 'For example: Win ₦5,000 with every crate',
    instructionsLabel: 'How to take part',
    instructionsHint:
      'For example: Scratch the card inside the cap and enter the code at acticlaim.com/claim.',
  },
} as const;

function createError(error: unknown) {
  if (error instanceof RequestError) {
    if (error.code === 'insufficient_balance')
      return 'Your available balance does not cover this campaign. Add funds or lower the amount.';
    if (error.code === 'terms_required')
      return 'Accept the current business terms before creating campaigns.';
    if (error.status === 400)
      return 'Check the details: the start must be in the future and the end after it.';
    if (error.status === 403)
      return 'Set up your business before creating campaigns.';
    if (error.status === 409)
      return 'This request was already used for different details. Press create again to start fresh.';
  }
  return 'We could not create the campaign. Check your connection and try again; it will not be created or charged twice.';
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="form-section">
      <legend>{title}</legend>
      {children}
    </fieldset>
  );
}

export function CampaignForm({ model }: { model: Model }) {
  const router = useRouter();
  const text = copy[model];
  const overview = useApiRead('business/overview?days=7', businessOverview);
  const [start] = useState(defaultStart);
  const [form, setForm] = useState({
    title: '',
    instructions: '',
    reward: '',
    capacity: '',
    startsAt: localInput(start),
    endsAt: localInput(new Date(start.getTime() + 30 * 86400000)),
    minSpend: '0',
    holdHours: 72,
    placeName: '',
    placeAddress: '',
    voidWhen: 'Refunded or cancelled orders.',
    claimLimit: '1',
    howToGetCodes: '',
    prizeType: 'cash' as 'cash' | 'item',
    prizeItem: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // Same body, same request ID: a retry after a lost response never locks
  // money twice.
  const attempt = useRef<{ key: string; id: string } | null>(null);
  const set = (key: keyof typeof form) => (value: string | number) => {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => ({ ...e, [key]: '' }));
  };

  const rewardKobo = toKobo(form.reward);
  const capacity = /^[1-9]\d{0,5}$/.test(form.capacity)
    ? Number(form.capacity)
    : null;
  const total =
    rewardKobo && capacity ? BigInt(rewardKobo) * BigInt(capacity) : null;
  const available = overview.data ? BigInt(overview.data.availableKobo) : null;
  const short =
    total !== null && available !== null && total > available
      ? total - available
      : null;

  function validate() {
    const next: Record<string, string> = {};
    if (!form.title.trim()) next.title = 'Give the campaign a name.';
    if (!form.instructions.trim())
      next.instructions = 'Tell people what to do.';
    if (!rewardKobo) next.reward = 'Enter an amount in naira.';
    if (!capacity) next.capacity = 'Enter a whole number from 1.';
    const startsAt = new Date(form.startsAt);
    const endsAt = new Date(form.endsAt);
    if (Number.isNaN(startsAt.getTime()) || !inFuture(startsAt))
      next.startsAt = 'Choose a start in the future.';
    if (Number.isNaN(endsAt.getTime()) || endsAt <= startsAt)
      next.endsAt = 'The end must be after the start.';
    if (model === 'purchase_cashback') {
      if (toKobo(form.minSpend) === null && form.minSpend.trim() !== '0')
        next.minSpend = 'Enter 0 or an amount in naira.';
      if (!form.placeName.trim()) next.placeName = 'Where do shoppers buy?';
      if (!form.placeAddress.trim())
        next.placeAddress = 'Add the address shoppers will visit.';
      if (!form.voidWhen.trim())
        next.voidWhen = 'Say when you may void a purchase.';
    } else {
      if (!/^([1-9]|1\d|20)$/.test(form.claimLimit))
        next.claimLimit = 'Between 1 and 20.';
      if (!form.howToGetCodes.trim())
        next.howToGetCodes = 'Say where customers find codes.';
      if (form.prizeType === 'item' && !form.prizeItem.trim())
        next.prizeItem =
          'Describe the prize, for example a crate of 12 drinks.';
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  function body() {
    const common = {
      title: form.title.trim(),
      instructions: form.instructions.trim(),
      model,
      capacity: capacity!,
      rewardKobo: rewardKobo!,
      startsAt: new Date(form.startsAt).toISOString(),
      endsAt: new Date(form.endsAt).toISOString(),
    };
    return model === 'purchase_cashback'
      ? {
          ...common,
          proofRequirements: 'Purchase confirmed by the business at the till.',
          rejectionCriteria: form.voidWhen.trim(),
          campaignTerms: {
            minSpendKobo: toKobo(form.minSpend) ?? '0',
            holdHours: form.holdHours,
            placeName: form.placeName.trim(),
            placeAddress: form.placeAddress.trim(),
          },
        }
      : {
          ...common,
          proofRequirements: 'A valid, unused winning code.',
          rejectionCriteria: 'Invalid, used or withdrawn codes.',
          promotionTerms: {
            mode: 'every_code_wins',
            permit: null,
            claimLimitPerPerson: Number(form.claimLimit),
            howToGetCodes: form.howToGetCodes.trim(),
            ...(form.prizeType === 'item'
              ? { prize: { item: form.prizeItem.trim() } }
              : {}),
          },
        };
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setError('');
    if (!validate()) return;
    const payload = body();
    const key = JSON.stringify(payload);
    if (attempt.current?.key !== key) attempt.current = { key, id: newId() };
    setBusy(true);
    try {
      await apiRequest('sponsor/tasks', created, {
        method: 'POST',
        body: { requestId: attempt.current.id, ...payload },
      });
      router.push(`${text.list}?created=1`);
    } catch (cause) {
      if (cause instanceof RequestError && cause.status < 500)
        attempt.current = null;
      setError(createError(cause));
      setBusy(false);
    }
  }

  const missing =
    overview.error instanceof RequestError && overview.error.status === 404;
  const field = (
    key: keyof typeof form,
    label: string,
    extra: Partial<Parameters<typeof Field>[0]> = {},
  ) => (
    <Field
      id={`campaign-${key}`}
      label={label}
      value={String(form[key])}
      onChange={(e) => set(key)(e.target.value)}
      error={errors[key]}
      {...extra}
    />
  );

  return (
    <DashShell
      crumbs={[
        { label: 'Business', href: '/business' },
        { label: text.listLabel, href: text.list },
        { label: 'New' },
      ]}
      business={overview.data?.business.name}
    >
      <DashHead title={text.title} intro={text.intro} />
      {overview.loading && !overview.data ? (
        <Loading>Loading your balance…</Loading>
      ) : missing ? (
        <NoBusiness />
      ) : overview.error && !overview.data ? (
        <WorkFailure error={overview.error} retry={overview.refresh} />
      ) : (
        <form className="create-grid" onSubmit={submit} noValidate>
          <div className="card grid gap-5">
            <Section title="The offer">
              {field('title', 'Campaign name', {
                maxLength: 160,
                hint: text.titleHint,
              })}
              <div className="field">
                <label htmlFor="campaign-instructions">
                  {text.instructionsLabel}
                </label>
                <textarea
                  id="campaign-instructions"
                  className="input textarea"
                  rows={3}
                  maxLength={2000}
                  value={form.instructions}
                  aria-invalid={Boolean(errors.instructions)}
                  aria-describedby="campaign-instructions-help"
                  onChange={(e) => set('instructions')(e.target.value)}
                />
                <p
                  id="campaign-instructions-help"
                  className={
                    errors.instructions
                      ? 'field-help field-error'
                      : 'field-help'
                  }
                >
                  {errors.instructions || text.instructionsHint}
                </p>
              </div>
            </Section>

            {model === 'claim_code' && (
              <Section title="The prize">
                <div className="field">
                  <span className="field-label" id="prize-label">
                    Prize type
                  </span>
                  <div
                    className="segmented preset-row two"
                    role="group"
                    aria-labelledby="prize-label"
                  >
                    {(
                      [
                        ['cash', 'Cash'],
                        ['item', 'An item'],
                      ] as const
                    ).map(([type, label]) => (
                      <button
                        key={type}
                        type="button"
                        aria-pressed={form.prizeType === type}
                        onClick={() => set('prizeType')(type)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <p className="field-help">
                    {form.prizeType === 'item'
                      ? 'Winners collect it in store with a voucher. Its cash value is locked as a deposit: it comes back to you on handover, or pays the winner if you do not hand it over within 14 days.'
                      : 'Winners are paid straight into their Acticlaim wallet.'}
                  </p>
                </div>
                {form.prizeType === 'item' &&
                  field('prizeItem', 'What winners get', {
                    maxLength: 160,
                    placeholder: 'A crate of 12 Fizz drinks',
                  })}
              </Section>
            )}

            <Section title="Money">
              <div className="pair">
                {field(
                  'reward',
                  model === 'claim_code' && form.prizeType === 'item'
                    ? 'Cash value of each prize (₦)'
                    : `${text.reward} (₦)`,
                  {
                    inputMode: 'decimal',
                    placeholder: model === 'claim_code' ? '5,000' : '500',
                  },
                )}
                {field('capacity', text.capacity, {
                  inputMode: 'numeric',
                  placeholder: '100',
                })}
              </div>
              {model === 'purchase_cashback' &&
                field('minSpend', 'Minimum spend (₦)', {
                  inputMode: 'decimal',
                  hint: '0 means any purchase qualifies.',
                })}
            </Section>

            {model === 'purchase_cashback' ? (
              <>
                <Section title="Where">
                  {field('placeName', 'Place name', { maxLength: 160 })}
                  {field('placeAddress', 'Address', { maxLength: 300 })}
                </Section>
                <Section title="Refunds">
                  <div className="field">
                    <span className="field-label" id="hold-label">
                      Refund window
                    </span>
                    <div
                      className="segmented preset-row"
                      role="group"
                      aria-labelledby="hold-label"
                    >
                      {holdChoices.map(([hours, label]) => (
                        <button
                          key={hours}
                          type="button"
                          aria-pressed={form.holdHours === hours}
                          onClick={() => set('holdHours')(hours)}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    <p className="field-help">
                      Cash back is held this long after each purchase, so you
                      can void refunded orders. Choose at least as long as your
                      own refund policy: once it ends, the cash back is the
                      customer&apos;s even if they return the goods later.
                    </p>
                  </div>
                  {field('voidWhen', 'You may void a purchase when', {
                    maxLength: 500,
                  })}
                </Section>
              </>
            ) : (
              <Section title="Codes and winners">
                <p className="field-help" style={{ margin: 0 }}>
                  Every code you create here is funded and wins its prize.
                  Acticlaim does not run draws. If you also hand out papers
                  without codes, that promotion and any permit it needs are your
                  responsibility.
                </p>
                <div className="pair">
                  {field('claimLimit', 'Prizes per person', {
                    inputMode: 'numeric',
                    hint: 'From 1 to 20.',
                  })}
                  {field('howToGetCodes', 'Where customers find codes', {
                    maxLength: 300,
                    placeholder: 'Under the cap of every 50cl bottle',
                  })}
                </div>
              </Section>
            )}

            <Section title="When">
              <div className="pair">
                {field('startsAt', 'Starts', { type: 'datetime-local' })}
                {field('endsAt', 'Ends', { type: 'datetime-local' })}
              </div>
            </Section>
          </div>

          <aside
            className="card grid gap-4 create-summary"
            aria-label="Summary"
          >
            <div className="card-head">
              <h2>Money locked now</h2>
              <p>
                {rewardKobo && capacity
                  ? `${naira(rewardKobo)} × ${capacity.toLocaleString('en-NG')}`
                  : 'Enter an amount and a number'}
              </p>
            </div>
            <p className="amount amount-xl" style={{ margin: 0 }}>
              {total !== null ? naira(total.toString()) : '₦0'}
            </p>
            {available !== null && (
              <p className="small-note">
                Available to spend: {naira(available.toString())}
              </p>
            )}
            {short !== null && (
              <Feedback error>
                You need {naira(short.toString())} more.{' '}
                <Link className="text-link" href="/business/funds">
                  Add funds
                </Link>
              </Feedback>
            )}
            {error && <Feedback error>{error}</Feedback>}
            <Button
              variant="accent"
              type="submit"
              disabled={busy || short !== null}
              className="full-width"
            >
              {busy
                ? 'Locking money…'
                : total !== null
                  ? `Lock ${naira(total.toString())} and submit`
                  : 'Lock money and submit'}
            </Button>
            <p className="small-note">
              Acticlaim reviews every campaign before it goes live. You choose
              when to publish it once approved. Unused money returns to your
              balance after it ends.
            </p>
          </aside>
        </form>
      )}
    </DashShell>
  );
}
