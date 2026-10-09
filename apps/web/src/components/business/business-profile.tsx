'use client';
import Link from 'next/link';
import { useState } from 'react';
import { ExternalLink, Lock } from 'lucide-react';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Feedback, Loading } from '@/components/ui/feedback';
import { Field } from '@/components/ui/field';
import { toast } from '@/components/ui/toast';
import { WorkFailure } from '@/components/work/work-frame';
import { apiRequest, newId, shortDate } from '@/lib/api';
import { RequestError } from '@/lib/auth-client';
import { businessDetails, cleanHandle } from '@/lib/profiles';
import { useApiRead } from '@/lib/use-api-read';
import { NoBusiness } from './business-home';
import { DashHead, DashShell } from './dash-shell';
import { HandleField } from './handle-field';

const changed = z.object({ state: z.enum(['applied', 'pending']) });
const fieldLabel: Record<string, string> = {
  name: 'Name',
  contact_email: 'Contact email',
  description: 'Description',
};
const stateChip = {
  applied: ['Saved', 'chip chip-done'],
  pending: ['Waiting for review', 'chip chip-pending'],
  rejected: ['Not approved', 'chip chip-danger'],
} as const;

function errorText(error: unknown) {
  if (error instanceof RequestError) {
    if (error.code === 'profile_change_pending')
      return 'A name change is already waiting for review.';
    if (error.code === 'handle_locked')
      return 'Your handle is locked. Contact Acticlaim support to change it.';
    if (error.code === 'handle_unavailable')
      return 'That handle was just taken. Choose another one.';
    if (error.status === 400) return 'Check the value and try again.';
  }
  return 'We could not save this. Check your connection and try again.';
}

// The owner's business details: what customers see, with every change kept.
export function BusinessProfile() {
  const read = useApiRead('sponsor/profile/details', businessDetails);
  const data = read.data;
  const missing =
    read.error instanceof RequestError && read.error.status === 404;
  const [form, setForm] = useState<{
    name: string;
    description: string;
    contactEmail: string;
  } | null>(null);
  const [handle, setHandle] = useState<string | null>(null);
  const [handleOk, setHandleOk] = useState(false);
  const [confirmHandle, setConfirmHandle] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const values = form ?? {
    name: data?.name ?? '',
    description: data?.description ?? '',
    contactEmail: data?.contactEmail ?? '',
  };
  const pendingName = data?.changes.find(
    (c) => c.field === 'name' && c.state === 'pending',
  );

  async function save(field: 'name' | 'description' | 'contact_email') {
    if (!data || busy) return;
    const value =
      field === 'name'
        ? values.name.trim()
        : field === 'description'
          ? values.description.trim()
          : values.contactEmail.trim();
    setBusy(field);
    setError('');
    try {
      const result = await apiRequest('sponsor/profile/changes', changed, {
        method: 'POST',
        body: { id: newId(), field, value },
      });
      toast(
        result.state === 'pending'
          ? 'Sent for review. Your current name stays until it is approved.'
          : `${fieldLabel[field]} saved`,
      );
      setForm(null);
      read.refresh();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(null);
    }
  }

  async function saveHandle() {
    if (!handle || busy) return;
    setBusy('handle');
    setError('');
    try {
      await apiRequest(
        'sponsor/profile/handle',
        z.object({ handle: z.string() }),
        { method: 'POST', body: { handle: cleanHandle(handle) } },
      );
      toast(`Your handle is now @${cleanHandle(handle)}`);
      setConfirmHandle(false);
      setHandle(null);
      read.refresh();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(null);
    }
  }

  const edit = (key: keyof typeof values) => (value: string) =>
    setForm({ ...values, [key]: value });

  return (
    <DashShell
      crumbs={[{ label: 'Business', href: '/business' }, { label: 'Profile' }]}
      business={data?.name}
    >
      <DashHead
        title="Business profile"
        intro="What customers see on your page and offers. Every change is kept, and recent names stay visible to customers."
        actions={
          data?.handle && (
            <Link
              className="button button-outline"
              href={`/b/${data.handle}`}
              target="_blank"
            >
              <ExternalLink size={16} aria-hidden /> View your page
            </Link>
          )
        }
      />
      {read.loading && !data ? (
        <Loading>Loading your profile…</Loading>
      ) : missing ? (
        <NoBusiness />
      ) : read.error && !data ? (
        <WorkFailure error={read.error} retry={read.refresh} />
      ) : (
        data && (
          <div className="grid gap-5" style={{ maxWidth: 720 }}>
            {error && <Feedback error>{error}</Feedback>}
            <section className="card grid gap-3">
              <h2 style={{ margin: 0, fontSize: '1.05rem' }}>Handle</h2>
              {data.canChangeHandle ? (
                <>
                  <HandleField
                    value={handle ?? data.handle ?? ''}
                    current={data.handle}
                    disabled={busy !== null}
                    hint="You can change it once, until your first campaign is approved. Then it is locked."
                    onChange={(next, ok) => {
                      if (next !== (handle ?? data.handle)) setHandle(next);
                      setHandleOk(ok);
                    }}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    style={{ justifySelf: 'start' }}
                    disabled={
                      !handle ||
                      !handleOk ||
                      cleanHandle(handle) === data.handle
                    }
                    onClick={() => setConfirmHandle(true)}
                  >
                    Change handle
                  </Button>
                </>
              ) : (
                <p className="icon-line" style={{ margin: 0 }}>
                  <Lock size={16} aria-hidden />
                  <strong>@{data.handle}</strong>
                  <span className="small-note">
                    Locked. Contact support if it must change.
                  </span>
                </p>
              )}
              {data.handles.length > 1 && (
                <p className="small-note">
                  Earlier handles still lead here:{' '}
                  {data.handles
                    .slice(1)
                    .map((h) => `@${h.handle}`)
                    .join(', ')}
                </p>
              )}
            </section>
            <section className="card grid gap-4">
              <h2 style={{ margin: 0, fontSize: '1.05rem' }}>Details</h2>
              <div className="grid gap-2">
                <Field
                  id="profile-name"
                  label="Business name"
                  maxLength={120}
                  value={values.name}
                  disabled={busy !== null || Boolean(pendingName)}
                  onChange={(e) => edit('name')(e.target.value)}
                  hint={
                    pendingName
                      ? `“${pendingName.newValue}” is waiting for review.`
                      : data.nameNeedsReview
                        ? 'A reviewer checks name changes once you have an approved campaign. Customers see your old name for 90 days.'
                        : 'Changes apply at once.'
                  }
                />
                <Button
                  type="button"
                  variant="outline"
                  style={{ justifySelf: 'start' }}
                  loading={busy === 'name'}
                  disabled={
                    !values.name.trim() || values.name.trim() === data.name
                  }
                  onClick={() => void save('name')}
                >
                  {data.nameNeedsReview ? 'Send for review' : 'Save name'}
                </Button>
              </div>
              <div className="grid gap-2">
                <label htmlFor="profile-description" className="field-label">
                  Description
                </label>
                <textarea
                  id="profile-description"
                  className="input textarea"
                  maxLength={500}
                  value={values.description}
                  disabled={busy !== null}
                  placeholder="What you sell and where. For example: Rice, swallow and grills on Herbert Macaulay Way, Yaba."
                  onChange={(e) => edit('description')(e.target.value)}
                />
                <Button
                  type="button"
                  variant="outline"
                  style={{ justifySelf: 'start' }}
                  loading={busy === 'description'}
                  disabled={
                    values.description.trim() === (data.description ?? '')
                  }
                  onClick={() => void save('description')}
                >
                  Save description
                </Button>
              </div>
              <div className="grid gap-2">
                <Field
                  id="profile-email"
                  label="Contact email"
                  type="email"
                  value={values.contactEmail}
                  disabled={busy !== null}
                  onChange={(e) => edit('contactEmail')(e.target.value)}
                  hint="For Acticlaim to reach your business. Not shown to customers."
                />
                <Button
                  type="button"
                  variant="outline"
                  style={{ justifySelf: 'start' }}
                  loading={busy === 'contact_email'}
                  disabled={
                    !values.contactEmail.trim() ||
                    values.contactEmail.trim() === data.contactEmail
                  }
                  onClick={() => void save('contact_email')}
                >
                  Save email
                </Button>
              </div>
            </section>
            {data.changes.length > 0 && (
              <section className="card">
                <h2 style={{ marginTop: 0, fontSize: '1.05rem' }}>
                  Change history
                </h2>
                <ul className="tx-list" style={{ border: 0 }}>
                  {data.changes.map((c) => {
                    const [label, chip] = stateChip[c.state];
                    return (
                      <li key={c.id}>
                        <div className="tx-row">
                          <div className="tx-main">
                            <p className="tx-title">
                              {fieldLabel[c.field] ?? c.field}
                            </p>
                            <p className="small-note">
                              {c.oldValue ? `“${c.oldValue}” → ` : ''}“
                              {c.newValue ?? ''}” · {shortDate(c.at)}
                              {c.note && c.state === 'rejected'
                                ? ` · ${c.note}`
                                : ''}
                            </p>
                          </div>
                          <span className={chip}>{label}</span>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}
            <ConfirmDialog
              open={confirmHandle}
              onClose={() => setConfirmHandle(false)}
              onConfirm={() => void saveHandle()}
              busy={busy === 'handle'}
              title={`Change your handle to @${cleanHandle(handle ?? '')}?`}
              description={`This is your only change. @${data.handle} stays reserved for you and leads to your new handle. After your first approved campaign the handle is locked for good.`}
              confirmLabel="Change handle"
              busyLabel="Changing…"
            />
          </div>
        )
      )}
    </DashShell>
  );
}
