'use client';
import Link from 'next/link';
import { useState } from 'react';
import type { FormEvent } from 'react';
import { ArrowRight } from 'lucide-react';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Feedback, Loading } from '@/components/ui/feedback';
import { Field } from '@/components/ui/field';
import { toast } from '@/components/ui/toast';
import { apiRequest, shortDate } from '@/lib/api';
import { privateFileUrl } from '@/lib/files';
import { profileChanges } from '@/lib/admin';
import { useApiRead } from '@/lib/use-api-read';
import { AdminFailure, AdminFrame } from './admin-frame';

type Item = z.infer<typeof profileChanges>['items'][number];

// Businesses renaming after an approved campaign. Approve a real rebrand;
// refuse a name that borrows another brand's trust.
export function AdminRenames() {
  const read = useApiRead('admin/profile-changes', profileChanges);
  const [deciding, setDeciding] = useState<{
    item: Item;
    decision: 'applied' | 'rejected';
  } | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function decide(event: FormEvent) {
    event.preventDefault();
    if (!deciding || busy || reason.trim().length < 3) return;
    setBusy(true);
    setError('');
    try {
      await apiRequest(
        `admin/profile-changes/${deciding.item.id}/decisions`,
        z.unknown(),
        {
          method: 'POST',
          body: { decision: deciding.decision, reason: reason.trim() },
        },
      );
      toast(deciding.decision === 'applied' ? 'Approved' : 'Refused');
      setDeciding(null);
      setReason('');
      read.refresh();
    } catch {
      setError(
        'We could not record the decision. You cannot decide your own business, and each rename is decided once.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <AdminFrame
      title="Names and logos"
      intro="Renames by businesses with an approved campaign, and every new logo. Approve a real rebrand; refuse anything that borrows another brand. Customers see an old name for 90 days."
    >
      {read.loading && !read.data ? (
        <Loading>Loading renames…</Loading>
      ) : read.error && !read.data ? (
        <AdminFailure error={read.error} retry={read.refresh} />
      ) : read.data?.items.length ? (
        <ul className="tx-list" style={{ maxWidth: 760 }}>
          {read.data.items.map((item) => (
            <li key={item.id}>
              <div className="rename-row">
                {item.field === 'logo' ? (
                  <div className="icon-line" style={{ gap: '0.75rem' }}>
                    {item.oldValue ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        className="logo-img"
                        src={privateFileUrl(item.oldValue)}
                        alt="Current logo"
                      />
                    ) : (
                      <span className="small-note">No logo yet</span>
                    )}
                    <ArrowRight size={15} aria-hidden />
                    {item.newValue && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        className="logo-img"
                        src={privateFileUrl(item.newValue)}
                        alt="New logo"
                      />
                    )}
                  </div>
                ) : (
                  <p className="tx-title" style={{ margin: 0 }}>
                    {item.oldValue}{' '}
                    <ArrowRight
                      size={15}
                      aria-hidden
                      style={{ verticalAlign: '-2px' }}
                    />{' '}
                    {item.newValue}
                  </p>
                )}
                <p className="small-note">
                  {item.handle && (
                    <Link href={`/b/${item.handle}`} target="_blank">
                      @{item.handle}
                    </Link>
                  )}{' '}
                  · asked {shortDate(item.at)}
                </p>
              </div>
              <div className="row" style={{ justifyContent: 'flex-start' }}>
                <Button
                  type="button"
                  variant="accent"
                  onClick={() => {
                    setError('');
                    setDeciding({ item, decision: 'applied' });
                  }}
                >
                  Approve
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setError('');
                    setDeciding({ item, decision: 'rejected' });
                  }}
                >
                  Refuse
                </Button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="small-note">Nothing waiting.</p>
      )}
      <Dialog
        open={deciding !== null}
        onClose={() => !busy && setDeciding(null)}
        title={
          deciding?.item.field === 'logo'
            ? deciding.decision === 'applied'
              ? 'Approve this logo?'
              : 'Refuse this logo?'
            : deciding?.decision === 'applied'
              ? `Approve “${deciding.item.newValue}”?`
              : `Refuse “${deciding?.item.newValue ?? ''}”?`
        }
        description="The business sees your reason."
      >
        <form className="grid gap-4" onSubmit={decide} noValidate>
          <Field
            id="rename-reason"
            label="Reason"
            placeholder={
              deciding?.decision === 'applied'
                ? 'Same business, new branch name'
                : 'Uses another brand’s name'
            }
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            disabled={busy}
            data-autofocus
          />
          {error && <Feedback error>{error}</Feedback>}
          <div className="dialog-foot">
            <Button
              variant="ghost"
              type="button"
              onClick={() => setDeciding(null)}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button
              variant={deciding?.decision === 'applied' ? 'accent' : 'danger'}
              type="submit"
              loading={busy}
              disabled={reason.trim().length < 3}
            >
              {deciding?.decision === 'applied' ? 'Approve' : 'Refuse'}
            </Button>
          </div>
        </form>
      </Dialog>
    </AdminFrame>
  );
}
