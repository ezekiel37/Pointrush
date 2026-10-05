'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Download, Printer, TriangleAlert } from 'lucide-react';
import type { z } from 'zod';
import { DashHead, DashShell } from './dash-shell';
import { Button } from '@/components/ui/button';
import { Feedback, Loading } from '@/components/ui/feedback';
import { Field } from '@/components/ui/field';
import { WorkFailure } from '@/components/work/work-frame';
import { apiRequest, naira, newId, shortDate } from '@/lib/api';
import { RequestError } from '@/lib/auth-client';
import { batchState, issuedBatch, promotionSummary } from '@/lib/rewards';
import { useApiRead } from '@/lib/use-api-read';

type Issued = z.infer<typeof issuedBatch>;
const chips = {
  issued: ['Not active', 'chip chip-pending'],
  active: ['Active', 'chip chip-done'],
  revoked: ['Withdrawn', 'chip chip-muted'],
} as const;

function managerError(error: unknown) {
  if (error instanceof RequestError) {
    switch (error.code) {
      case 'codes_exceed_prizes':
        return 'That is more codes than the prizes you funded. Reduce the batch size.';
      case 'batch_already_issued':
        return 'This batch was already issued and its codes cannot be shown again. Withdraw it and issue a new one.';
      case 'batch_unavailable':
        return 'This batch cannot change now. Codes activate only while the promotion is live, and withdrawn batches stay withdrawn.';
    }
    if (error.status === 400) return 'Check the label and batch size.';
  }
  return 'We could not confirm the result. Check your connection and try again.';
}

function download(batch: Issued) {
  const csv = ['code', ...batch.codes].join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `acticlaim-${batch.label.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

export function PromotionManager({ id }: { id: string }) {
  const summary = useApiRead(`promotions/${id}/summary`, promotionSummary);
  const [label, setLabel] = useState('');
  const [size, setSize] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [issued, setIssued] = useState<Issued | null>(null);
  const [saved, setSaved] = useState(false);
  const [revoking, setRevoking] = useState<{
    id: string;
    reason: string;
  } | null>(null);
  // The batch ID survives a lost response; a retry then reports it as issued
  // rather than silently creating a second batch.
  const batchId = useRef(newId());

  useEffect(() => {
    if (!issued || saved) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [issued, saved]);

  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (cause) {
      setError(managerError(cause));
    } finally {
      setBusy(false);
      summary.refresh();
    }
  }

  function issue(event: FormEvent) {
    event.preventDefault();
    const count = Number(size);
    if (!label.trim() || !Number.isInteger(count) || count < 1) {
      setError('Give the batch a name and a whole number of codes.');
      return;
    }
    void run(async () => {
      const result = await apiRequest(`promotions/${id}/batches`, issuedBatch, {
        method: 'POST',
        body: { id: batchId.current, label: label.trim(), size: count },
      });
      batchId.current = newId();
      setIssued(result);
      setSaved(false);
      setLabel('');
      setSize('');
    });
  }

  const data = summary.data;
  return (
    <DashShell
      crumbs={[
        { label: 'Business', href: '/business' },
        { label: 'Prize promotions', href: '/business/promotions' },
        { label: data?.title ?? 'Promotion' },
      ]}
    >
      <DashHead
        title={data?.title ?? 'Promotion'}
        intro="Issue printable codes, activate batches and track claims."
      />
      {summary.loading && !data ? (
        <Loading>Loading promotion…</Loading>
      ) : summary.error && !data ? (
        <WorkFailure error={summary.error} retry={summary.refresh} />
      ) : (
        data && (
          <div className="grid gap-6">
            <dl className="stat-row" style={{ margin: 0 }}>
              <div className="stat">
                <dt>Prize</dt>
                <dd className="amount" style={{ fontSize: '1.6rem' }}>
                  {naira(data.prizeKobo)}
                </dd>
              </div>
              <div className="stat">
                <dt>Claimed</dt>
                <dd className="amount" style={{ fontSize: '1.6rem' }}>
                  {data.claimed}
                  <span className="small-note"> / {data.prizes}</span>
                </dd>
              </div>
              <div className="stat">
                <dt>Codes issued</dt>
                <dd className="amount" style={{ fontSize: '1.6rem' }}>
                  {data.issued}
                </dd>
              </div>
              <div className="stat">
                <dt>Can still issue</dt>
                <dd className="amount" style={{ fontSize: '1.6rem' }}>
                  {data.availableToIssue}
                </dd>
              </div>
            </dl>

            {issued && (
              <section
                className="card grid gap-3"
                style={{ borderColor: 'var(--color-ink)', borderWidth: 1.5 }}
                aria-labelledby="issued-heading"
              >
                <p
                  className="chip chip-pending"
                  style={{ width: 'fit-content' }}
                >
                  <TriangleAlert size={14} aria-hidden /> Shown once
                </p>
                <h2 id="issued-heading" style={{ margin: 0 }}>
                  {issued.codes.length} codes for “{issued.label}”
                </h2>
                <p className="small-note">
                  Acticlaim keeps only a fingerprint of each code. Download them
                  now for printing; they cannot be shown again. Activate the
                  batch once the papers are in stores.
                </p>
                <div className="flex flex-wrap gap-3">
                  <Button
                    variant="accent"
                    type="button"
                    onClick={() => {
                      download(issued);
                      setSaved(true);
                    }}
                  >
                    <Download size={17} aria-hidden /> Download codes (CSV)
                  </Button>
                  <Button
                    variant="outline"
                    type="button"
                    onClick={() => {
                      setSaved(true);
                      window.print();
                    }}
                  >
                    <Printer size={17} aria-hidden /> Print
                  </Button>
                  {saved && (
                    <Button
                      variant="ghost"
                      type="button"
                      onClick={() => setIssued(null)}
                    >
                      I have saved them
                    </Button>
                  )}
                </div>
                <ol
                  className="num"
                  style={{
                    display: 'grid',
                    gridTemplateColumns:
                      'repeat(auto-fill, minmax(15.5rem, 1fr))',
                    gap: '0.35rem 1rem',
                    maxHeight: '18rem',
                    overflow: 'auto',
                    margin: 0,
                    paddingLeft: '2.5rem',
                    fontSize: '0.95rem',
                  }}
                >
                  {issued.codes.map((code) => (
                    <li key={code}>{code}</li>
                  ))}
                </ol>
              </section>
            )}

            {error && <Feedback error>{error}</Feedback>}

            {data.availableToIssue > 0 && !issued && (
              <form
                className="card grid gap-4"
                onSubmit={issue}
                style={{ maxWidth: 560 }}
              >
                <h2 style={{ margin: 0 }}>Issue codes for printing</h2>
                <Field
                  id="batch-label"
                  label="Batch name"
                  hint="Where these papers go, for example “Ikeja stores, week 1”."
                  value={label}
                  onChange={(event) => setLabel(event.target.value)}
                  disabled={busy}
                />
                <Field
                  id="batch-size"
                  label="Number of codes"
                  hint={`Up to ${data.availableToIssue}: one funded prize per code.`}
                  inputMode="numeric"
                  value={size}
                  onChange={(event) =>
                    setSize(event.target.value.replace(/\D/g, ''))
                  }
                  disabled={busy}
                />
                <Button type="submit" disabled={busy}>
                  {busy ? 'Issuing…' : 'Issue codes'}
                </Button>
              </form>
            )}

            <section aria-labelledby="batches-heading">
              <h2 id="batches-heading">Batches</h2>
              {data.batches.length ? (
                <ul className="stack">
                  {data.batches.map((batch) => {
                    const [text, chip] = chips[batch.state];
                    return (
                      <li
                        key={batch.id}
                        className="card row"
                        style={{ flexWrap: 'wrap' }}
                      >
                        <div>
                          <p style={{ margin: 0, fontWeight: 600 }}>
                            {batch.label}
                          </p>
                          <p className="small-note num">
                            {batch.claimed} of {batch.size} claimed · issued{' '}
                            {shortDate(batch.createdAt)}
                          </p>
                        </div>
                        <div
                          className="row"
                          style={{ justifyContent: 'flex-end' }}
                        >
                          <span className={chip}>{text}</span>
                          {batch.state === 'issued' && (
                            <Button
                              type="button"
                              disabled={busy}
                              onClick={() =>
                                void run(async () => {
                                  await apiRequest(
                                    `code-batches/${batch.id}/activations`,
                                    batchState,
                                    { method: 'POST', body: {} },
                                  );
                                })
                              }
                            >
                              Activate
                            </Button>
                          )}
                          {batch.state !== 'revoked' &&
                            revoking?.id !== batch.id && (
                              <Button
                                variant="ghost"
                                type="button"
                                onClick={() =>
                                  setRevoking({ id: batch.id, reason: '' })
                                }
                              >
                                Withdraw
                              </Button>
                            )}
                        </div>
                        {revoking?.id === batch.id && (
                          <form
                            className="grid gap-3"
                            style={{ flexBasis: '100%' }}
                            onSubmit={(event) => {
                              event.preventDefault();
                              if (!revoking.reason.trim()) return;
                              void run(async () => {
                                await apiRequest(
                                  `code-batches/${batch.id}/revocations`,
                                  batchState,
                                  {
                                    method: 'POST',
                                    body: { reason: revoking.reason.trim() },
                                  },
                                );
                                setRevoking(null);
                              });
                            }}
                          >
                            <Field
                              id={`revoke-${batch.id}`}
                              label="Why withdraw this batch?"
                              hint="Unclaimed codes stop working. Their prizes can be issued again."
                              placeholder="Box of papers lost in transit"
                              value={revoking.reason}
                              onChange={(event) =>
                                setRevoking({
                                  id: batch.id,
                                  reason: event.target.value,
                                })
                              }
                              disabled={busy}
                            />
                            <div className="flex flex-wrap gap-3">
                              <Button
                                type="submit"
                                disabled={busy || !revoking.reason.trim()}
                              >
                                Withdraw batch
                              </Button>
                              <Button
                                variant="ghost"
                                type="button"
                                onClick={() => setRevoking(null)}
                              >
                                Cancel
                              </Button>
                            </div>
                          </form>
                        )}
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="small-note">Issued batches appear here.</p>
              )}
            </section>
            <Link className="text-link" href="/business">
              All campaigns
            </Link>
          </div>
        )
      )}
    </DashShell>
  );
}
