'use client';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { RotateCcw, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Feedback, Loading } from '@/components/ui/feedback';
import { Field } from '@/components/ui/field';
import { toast } from '@/components/ui/toast';
import { apiRequest, shortDate } from '@/lib/api';
import { RequestError } from '@/lib/auth-client';
import { nairaOf, settingsRead, settingsShape } from '@/lib/admin';
import type { PlatformSettings } from '@/lib/admin';
import { useApiRead } from '@/lib/use-api-read';
import { z } from 'zod';
import { AdminFailure, AdminFrame } from './admin-frame';

type Path =
  | ['funding', 'minKobo' | 'maxKobo']
  | [
      'campaigns',
      (
        | 'minCashbackKobo'
        | 'minPrizeKobo'
        | 'minJobRewardKobo'
        | 'minBudgetKobo'
        | 'maxRewardKobo'
        | 'maxBudgetKobo'
      ),
    ]
  | ['newBusinesses', 'days' | 'maxFundingKobo' | 'maxBudgetKobo']
  | ['withdrawals', 'minKobo' | 'maxKobo' | 'dailyKobo' | 'dailyCount']
  | ['newAccounts', 'days' | 'dailyWithdrawalKobo']
  | ['referrals', 'monthlyKobo' | 'monthlyCount']
  | ['referrals', 'friend', 'rewardKobo' | 'maxPercent' | 'minQualifyingKobo']
  | [
      'referrals',
      'business',
      'rewardKobo' | 'maxPercent' | 'minFundingKobo' | 'minPaidOutKobo',
    ];

// Ceilings match the API: they stop an extra zero becoming a real loss.
const ceilings: Record<string, number> = {
  'funding.minKobo': 100_000_000,
  'funding.maxKobo': 10_000_000_000,
  'campaigns.minCashbackKobo': 10_000_000,
  'campaigns.minPrizeKobo': 10_000_000,
  'campaigns.minJobRewardKobo': 10_000_000,
  'campaigns.minBudgetKobo': 1_000_000_000,
  'campaigns.maxRewardKobo': 1_000_000_000,
  'campaigns.maxBudgetKobo': 10_000_000_000,
  'newBusinesses.maxFundingKobo': 10_000_000_000,
  'newBusinesses.maxBudgetKobo': 10_000_000_000,
  'withdrawals.minKobo': 10_000_000,
  'withdrawals.maxKobo': 500_000_000,
  'withdrawals.dailyKobo': 1_000_000_000,
  'newAccounts.dailyWithdrawalKobo': 1_000_000_000,
  'referrals.friend.rewardKobo': 5_000_000,
  'referrals.friend.minQualifyingKobo': 10_000_000,
  'referrals.business.rewardKobo': 20_000_000,
  'referrals.business.minFundingKobo': 1_000_000_000,
  'referrals.business.minPaidOutKobo': 1_000_000_000,
  'referrals.monthlyKobo': 100_000_000,
};

function get(s: PlatformSettings, path: Path): number {
  let value: unknown = s;
  for (const key of path) value = (value as Record<string, unknown>)[key];
  return value as number;
}
function set(s: PlatformSettings, path: Path, value: number) {
  const next = structuredClone(s);
  let target = next as unknown as Record<string, unknown>;
  for (const key of path.slice(0, -1))
    target = target[key] as Record<string, unknown>;
  target[path.at(-1)!] = value;
  return next;
}

// The same checks the API makes, shown next to the field before saving.
function problems(s: PlatformSettings) {
  const out: Record<string, string> = {};
  for (const [key, max] of Object.entries(ceilings)) {
    const v = key
      .split('.')
      .reduce<unknown>((o, k) => (o as Record<string, unknown>)[k], s);
    if (typeof v === 'number' && v > max) out[key] = `At most ${nairaOf(max)}`;
  }
  const r = s.referrals;
  const c = s.campaigns;
  for (const key of [
    'minCashbackKobo',
    'minPrizeKobo',
    'minJobRewardKobo',
  ] as const)
    if (c[key] > c.maxRewardKobo)
      out[`campaigns.${key}`] = 'Must not exceed the largest payment';
  if (c.maxBudgetKobo < c.minBudgetKobo)
    out['campaigns.maxBudgetKobo'] = 'Must be at least the minimum';
  const nb = s.newBusinesses;
  if (nb.maxBudgetKobo > c.maxBudgetKobo)
    out['newBusinesses.maxBudgetKobo'] =
      'Must not exceed the limit for all businesses';
  if (nb.maxBudgetKobo < c.minBudgetKobo)
    out['newBusinesses.maxBudgetKobo'] =
      'Must be at least the campaign minimum, or new businesses cannot start';
  if (nb.maxFundingKobo > s.funding.maxKobo)
    out['newBusinesses.maxFundingKobo'] =
      'Must not exceed the top-up limit for all businesses';
  if (nb.maxFundingKobo < s.funding.minKobo)
    out['newBusinesses.maxFundingKobo'] = 'Must be at least the minimum top-up';
  if (nb.days > 365) out['newBusinesses.days'] = 'At most 365 days';
  const w = s.withdrawals;
  if (w.minKobo < 10000) out['withdrawals.minKobo'] = 'At least ₦100';
  if (w.maxKobo < w.minKobo)
    out['withdrawals.maxKobo'] = 'Must be at least the minimum';
  if (w.dailyKobo < w.maxKobo)
    out['withdrawals.dailyKobo'] = 'Must be at least one largest withdrawal';
  if (w.dailyCount < 1 || w.dailyCount > 20)
    out['withdrawals.dailyCount'] = 'Between 1 and 20';
  if (s.newAccounts.dailyWithdrawalKobo > w.dailyKobo)
    out['newAccounts.dailyWithdrawalKobo'] =
      'Must not exceed the daily limit for everyone';
  if (s.newAccounts.dailyWithdrawalKobo < w.minKobo)
    out['newAccounts.dailyWithdrawalKobo'] =
      'Must be at least the smallest withdrawal';
  if (s.newAccounts.days > 365) out['newAccounts.days'] = 'At most 365 days';
  if (s.funding.minKobo < 10000) out['funding.minKobo'] = 'At least ₦100';
  if (s.funding.maxKobo < s.funding.minKobo)
    out['funding.maxKobo'] = 'Must be at least the minimum top-up';
  if (s.campaigns.minBudgetKobo < s.campaigns.minCashbackKobo)
    out['campaigns.minBudgetKobo'] = 'Must be at least the minimum cash back';
  if (r.business.minFundingKobo < s.funding.minKobo)
    out['referrals.business.minFundingKobo'] =
      'Must be at least the minimum top-up';
  if (r.business.minFundingKobo < r.business.minPaidOutKobo)
    out['referrals.business.minFundingKobo'] =
      'Must be at least the paid-out amount that qualifies';
  if (r.friend.rewardKobo > r.monthlyKobo)
    out['referrals.friend.rewardKobo'] = 'Must not exceed the monthly limit';
  if (r.business.rewardKobo > r.monthlyKobo)
    out['referrals.business.rewardKobo'] = 'Must not exceed the monthly limit';
  if (r.friend.maxPercent < 1 || r.friend.maxPercent > 100)
    out['referrals.friend.maxPercent'] = 'Between 1 and 100';
  if (r.business.maxPercent < 1 || r.business.maxPercent > 50)
    out['referrals.business.maxPercent'] = 'Between 1 and 50';
  if (r.monthlyCount < 0 || r.monthlyCount > 1000)
    out['referrals.monthlyCount'] = 'Between 0 and 1,000';
  return out;
}

const pay = (reward: number, percent: number, basis: number) =>
  Math.min(reward, Math.floor((basis * percent) / 100));

function Money({
  settings,
  path,
  label,
  hint,
  error,
  disabled,
  onChange,
}: {
  settings: PlatformSettings;
  path: Path;
  label: string;
  hint?: string;
  error?: string;
  disabled: boolean;
  onChange: (next: PlatformSettings) => void;
}) {
  const id = `setting-${path.join('-')}`;
  const [text, setText] = useState(String(get(settings, path) / 100));
  return (
    <Field
      id={id}
      label={`${label} (₦)`}
      inputMode="decimal"
      value={text}
      hint={hint}
      error={error}
      disabled={disabled}
      onChange={(event) => {
        setText(event.target.value);
        const n = Number(event.target.value.replace(/,/g, ''));
        if (Number.isFinite(n) && n >= 0)
          onChange(set(settings, path, Math.round(n * 100)));
      }}
    />
  );
}

function Count({
  settings,
  path,
  label,
  hint,
  error,
  disabled,
  onChange,
}: {
  settings: PlatformSettings;
  path: Path;
  label: string;
  hint?: string;
  error?: string;
  disabled: boolean;
  onChange: (next: PlatformSettings) => void;
}) {
  return (
    <Field
      id={`setting-${path.join('-')}`}
      label={label}
      inputMode="numeric"
      value={String(get(settings, path))}
      hint={hint}
      error={error}
      disabled={disabled}
      onChange={(event) => {
        const n = Number(event.target.value || 0);
        if (Number.isInteger(n) && n >= 0) onChange(set(settings, path, n));
      }}
    />
  );
}

function Toggle({
  checked,
  label,
  disabled,
  onChange,
}: {
  checked: boolean;
  label: string;
  disabled: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="switch">
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span aria-hidden className="switch-track" />
      {label}
    </label>
  );
}

function Section({
  title,
  intro,
  children,
}: {
  title: string;
  intro: string;
  children: ReactNode;
}) {
  return (
    <section className="card grid gap-4">
      <div className="card-head" style={{ margin: 0 }}>
        <h2>{title}</h2>
        <p>{intro}</p>
      </div>
      {children}
    </section>
  );
}

const saved = z.object({ id: z.uuid(), current: settingsShape });

export function AdminSettings() {
  const read = useApiRead('admin/settings', settingsRead);
  const [draft, setDraft] = useState<PlatformSettings | null>(null);
  // Remounts the money inputs when the draft is reset or saved.
  const [generation, setGeneration] = useState(0);
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const data = read.data;
  const s = draft ?? data?.current;
  const issues = s ? problems(s) : {};
  const changed =
    draft !== null && JSON.stringify(draft) !== JSON.stringify(data?.current);
  const locked = !data?.canEdit || busy;

  async function save() {
    if (!draft || reason.trim().length < 3) return;
    setBusy(true);
    setError('');
    try {
      await apiRequest('admin/settings', saved, {
        method: 'POST',
        body: { settings: draft, reason: reason.trim() },
      });
      toast('Settings saved');
      setConfirming(false);
      setReason('');
      setDraft(null);
      setGeneration((g) => g + 1);
      read.refresh();
    } catch (cause) {
      setError(
        cause instanceof RequestError && cause.code === 'settings_read_only'
          ? 'Your account can view settings but not change them.'
          : cause instanceof RequestError && cause.code === 'invalid_settings'
            ? 'Some values are out of range. Check the fields marked in red.'
            : 'We could not save. Nothing changed; try again.',
      );
    } finally {
      setBusy(false);
    }
  }

  const common = (path: Path) => ({
    settings: s!,
    path,
    disabled: locked,
    error: issues[path.join('.')],
    onChange: setDraft,
  });
  const r = s?.referrals;
  return (
    <AdminFrame
      title="Settings"
      intro="Minimums and referral rewards. Changes apply at once to new campaigns, top-ups and referrals; every change keeps who made it and why."
    >
      {read.loading && !data ? (
        <Loading>Loading settings…</Loading>
      ) : read.error && !data ? (
        <AdminFailure error={read.error} retry={read.refresh} />
      ) : (
        s &&
        r &&
        data && (
          <div
            className="grid gap-5"
            style={{ maxWidth: 820 }}
            key={generation}
          >
            {!data.canEdit && (
              <Feedback>
                You can view these settings. Changing them needs a settings
                admin (SETTINGS_ADMIN_ACCOUNT_IDS on the API).
              </Feedback>
            )}
            <Section
              title="Business top-ups"
              intro="How much a business can add in one payment."
            >
              <div className="form-pair">
                <Money {...common(['funding', 'minKobo'])} label="Minimum" />
                <Money {...common(['funding', 'maxKobo'])} label="Maximum" />
              </div>
            </Section>
            <Section
              title="Campaign limits"
              intro="What a business can pay per place and lock per campaign. Tiny rewards invite abuse; very large ones need trust first."
            >
              <div className="form-pair">
                <Money
                  {...common(['campaigns', 'minCashbackKobo'])}
                  label="Least cash back per purchase"
                />
                <Money
                  {...common(['campaigns', 'minPrizeKobo'])}
                  label="Least per prize"
                />
                <Money
                  {...common(['campaigns', 'minJobRewardKobo'])}
                  label="Least per job"
                />
                <Money
                  {...common(['campaigns', 'maxRewardKobo'])}
                  label="Most per place"
                  hint="Cash back, prize or job payment"
                />
                <Money
                  {...common(['campaigns', 'minBudgetKobo'])}
                  label="Least a campaign locks"
                  hint="Payment × places"
                />
                <Money
                  {...common(['campaigns', 'maxBudgetKobo'])}
                  label="Most a campaign locks"
                />
              </div>
            </Section>
            <Section
              title="New businesses"
              intro="Lower limits while a business is new here, counted from the day it was created."
            >
              <div className="form-pair">
                <Count
                  {...common(['newBusinesses', 'days'])}
                  label="New for this many days"
                  hint="0 turns this off"
                />
                <Money
                  {...common(['newBusinesses', 'maxFundingKobo'])}
                  label="Most per top-up"
                />
                <Money
                  {...common(['newBusinesses', 'maxBudgetKobo'])}
                  label="Most a campaign locks"
                />
              </div>
            </Section>
            <Section
              title="Withdrawals"
              intro="Money people take out of their wallet to a bank. The database enforces these limits too."
            >
              <div className="form-pair">
                <Money
                  {...common(['withdrawals', 'minKobo'])}
                  label="Least per withdrawal"
                />
                <Money
                  {...common(['withdrawals', 'maxKobo'])}
                  label="Most per withdrawal"
                />
                <Money
                  {...common(['withdrawals', 'dailyKobo'])}
                  label="Most per day"
                />
                <Count
                  {...common(['withdrawals', 'dailyCount'])}
                  label="Withdrawals per day"
                />
              </div>
              <div className="settings-sub">
                <h3>New accounts</h3>
                <div className="form-pair">
                  <Count
                    {...common(['newAccounts', 'days'])}
                    label="New for this many days"
                    hint="0 turns this off"
                  />
                  <Money
                    {...common(['newAccounts', 'dailyWithdrawalKobo'])}
                    label="Most per day while new"
                  />
                </div>
              </div>
            </Section>
            <Section
              title="Referrals"
              intro="Paid by Acticlaim from the referral pool, never by businesses. Each reward is the smaller of the fixed amount and a share of real money that moved, so a ₦50 offer can never earn ₦500."
            >
              <Toggle
                checked={r.enabled}
                label="Referral rewards on"
                disabled={locked}
                onChange={(v) =>
                  setDraft({ ...s, referrals: { ...r, enabled: v } })
                }
              />
              <div className="settings-sub">
                <h3>Invite a friend</h3>
                <Toggle
                  checked={r.friend.enabled}
                  label="On"
                  disabled={locked || !r.enabled}
                  onChange={(v) =>
                    setDraft({
                      ...s,
                      referrals: { ...r, friend: { ...r.friend, enabled: v } },
                    })
                  }
                />
                <div className="form-pair">
                  <Money
                    {...common(['referrals', 'friend', 'rewardKobo'])}
                    label="Reward up to"
                  />
                  <Count
                    {...common(['referrals', 'friend', 'maxPercent'])}
                    label="At most this % of the friend's first payout"
                  />
                  <Money
                    {...common(['referrals', 'friend', 'minQualifyingKobo'])}
                    label="Friend's first payout must be at least"
                  />
                </div>
                <p className="settings-example">
                  Example: a friend&apos;s first cash back of{' '}
                  {nairaOf(r.friend.minQualifyingKobo)} pays the inviter{' '}
                  <strong>
                    {nairaOf(
                      pay(
                        r.friend.rewardKobo,
                        r.friend.maxPercent,
                        r.friend.minQualifyingKobo,
                      ),
                    )}
                  </strong>
                  . A first cash back of ₦50 pays nothing: it is below the
                  minimum.
                </p>
              </div>
              <div className="settings-sub">
                <h3>Invite a business</h3>
                <Toggle
                  checked={r.business.enabled}
                  label="On"
                  disabled={locked || !r.enabled}
                  onChange={(v) =>
                    setDraft({
                      ...s,
                      referrals: {
                        ...r,
                        business: { ...r.business, enabled: v },
                      },
                    })
                  }
                />
                <div className="form-pair">
                  <Money
                    {...common(['referrals', 'business', 'rewardKobo'])}
                    label="Reward up to"
                  />
                  <Count
                    {...common(['referrals', 'business', 'maxPercent'])}
                    label="At most this % of what the business paid out"
                  />
                  <Money
                    {...common(['referrals', 'business', 'minFundingKobo'])}
                    label="Business must have funded at least"
                  />
                  <Money
                    {...common(['referrals', 'business', 'minPaidOutKobo'])}
                    label="And paid its customers at least"
                    hint="Paid only after real customers were paid, so a fake business cannot fund, cancel and cash in."
                  />
                </div>
                <p className="settings-example">
                  Example: once the business has funded{' '}
                  {nairaOf(r.business.minFundingKobo)} and paid customers{' '}
                  {nairaOf(r.business.minPaidOutKobo)}, the inviter gets{' '}
                  <strong>
                    {nairaOf(
                      pay(
                        r.business.rewardKobo,
                        r.business.maxPercent,
                        r.business.minPaidOutKobo,
                      ),
                    )}
                  </strong>
                  .
                </p>
              </div>
              <div className="form-pair">
                <Count
                  {...common(['referrals', 'monthlyCount'])}
                  label="Rewards per person per month"
                />
                <Money
                  {...common(['referrals', 'monthlyKobo'])}
                  label="Most one person earns per month"
                />
              </div>
            </Section>
            <div className="row" style={{ justifyContent: 'flex-start' }}>
              <Button
                variant="accent"
                type="button"
                disabled={!changed || Object.keys(issues).length > 0 || locked}
                onClick={() => {
                  setError('');
                  setConfirming(true);
                }}
              >
                <Save size={17} aria-hidden /> Review and save
              </Button>
              {changed && (
                <Button
                  variant="ghost"
                  type="button"
                  onClick={() => {
                    setDraft(null);
                    setGeneration((g) => g + 1);
                  }}
                >
                  <RotateCcw size={17} aria-hidden /> Undo changes
                </Button>
              )}
            </div>
            <section className="card">
              <h2 style={{ marginTop: 0, fontSize: '1rem' }}>Recent changes</h2>
              <ul className="stack">
                {data.history.map((h) => (
                  <li key={h.id}>
                    {h.reason}
                    <span className="small-note">
                      {' '}
                      {h.by ? `@${h.by}` : 'Installed'} · {shortDate(h.at)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
            <Dialog
              open={confirming}
              onClose={() => !busy && setConfirming(false)}
              title="Save these settings?"
              description="They apply at once. Write why, so the next person understands the change."
            >
              <div className="grid gap-4">
                <Field
                  id="settings-reason"
                  label="Reason"
                  placeholder="Raise the floor after small-offer abuse"
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  data-autofocus
                  disabled={busy}
                />
                {error && <Feedback error>{error}</Feedback>}
                <div className="dialog-foot">
                  <Button
                    variant="ghost"
                    type="button"
                    onClick={() => setConfirming(false)}
                    disabled={busy}
                  >
                    Cancel
                  </Button>
                  <Button
                    variant="accent"
                    type="button"
                    loading={busy}
                    disabled={reason.trim().length < 3}
                    onClick={() => void save()}
                  >
                    Save settings
                  </Button>
                </div>
              </div>
            </Dialog>
          </div>
        )
      )}
    </AdminFrame>
  );
}
