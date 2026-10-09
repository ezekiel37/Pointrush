'use client';
import { useState } from 'react';
import type { FormEvent } from 'react';
import { Pencil } from 'lucide-react';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Feedback } from '@/components/ui/feedback';
import { Field } from '@/components/ui/field';
import { toast } from '@/components/ui/toast';
import { apiRequest } from '@/lib/api';
import { RequestError } from '@/lib/auth-client';
import { FileButton } from '@/components/ui/file-button';
import { publicFileUrl } from '@/lib/files';
import { useApiRead } from '@/lib/use-api-read';

const avatarRead = z.object({ fileId: z.uuid().nullable() });

type Kind = 'displayName' | 'username';
const copy = {
  displayName: {
    title: 'Change your name',
    description: 'The name people see. You can change it once every 7 days.',
    label: 'Display name',
    path: 'accounts/me/display-name',
  },
  username: {
    title: 'Change your username',
    description:
      'You can change it once every 30 days. Your old username stays yours, so invite links that use it keep working.',
    label: 'Username',
    path: 'accounts/me/username',
  },
} as const;

function errorText(kind: Kind, error: unknown) {
  if (error instanceof RequestError) {
    if (error.code === 'display_name_too_soon')
      return 'You changed your name in the last 7 days. Try again later.';
    if (error.status === 409) return 'That username is taken. Try another one.';
    if (error.status === 400)
      return kind === 'username'
        ? 'Use 3–20 letters, numbers or underscores, starting with a letter. You can change it once every 30 days.'
        : 'Use a visible name of 1–80 characters.';
  }
  return 'We could not save this. Check your connection and try again.';
}

// Name and username, each changed through a small dialog.
export function IdentityPanel({
  displayName,
  username,
  onSaved,
}: {
  displayName: string;
  username: string;
  onSaved: () => void;
}) {
  const avatar = useApiRead('accounts/me/avatar', avatarRead);
  const [pictureError, setPictureError] = useState('');
  const [editing, setEditing] = useState<Kind | null>(null);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  function open(kind: Kind) {
    setEditing(kind);
    setValue(kind === 'displayName' ? displayName : username);
    setError('');
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!editing || busy || !value.trim()) return;
    setBusy(true);
    setError('');
    try {
      await apiRequest(copy[editing].path, z.unknown(), {
        method: 'POST',
        body: { [editing]: value.trim() },
      });
      toast(editing === 'username' ? 'Username changed' : 'Name changed');
      setEditing(null);
      onSaved();
    } catch (cause) {
      setError(errorText(editing, cause));
    } finally {
      setBusy(false);
    }
  }

  async function setPicture(fileId: string | null) {
    try {
      await apiRequest('accounts/me/avatar', avatarRead, {
        method: 'POST',
        body: { fileId },
      });
      toast(fileId ? 'Picture updated' : 'Picture removed');
      avatar.refresh();
    } catch {
      setPictureError('We could not save your picture. Try again.');
    }
  }

  const fileId = avatar.data?.fileId ?? null;
  return (
    <section className="account-panel">
      <h2>Your profile</h2>
      <div className="avatar-row">
        {fileId ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            className="avatar avatar-lg"
            src={publicFileUrl(fileId)}
            alt="Your profile picture"
          />
        ) : (
          <span className="avatar avatar-lg" aria-hidden>
            {displayName.slice(0, 1).toUpperCase()}
          </span>
        )}
        <div className="grid gap-2">
          <div className="row" style={{ justifyContent: 'flex-start' }}>
            <FileButton
              purpose="avatar"
              onError={setPictureError}
              onUploaded={(file) => void setPicture(file.id)}
            >
              {fileId ? 'Change picture' : 'Add a picture'}
            </FileButton>
            {fileId && (
              <Button
                type="button"
                variant="ghost"
                onClick={() => void setPicture(null)}
              >
                Remove
              </Button>
            )}
          </div>
          <p className="small-note" style={{ margin: 0 }}>
            JPEG, PNG or WebP up to 2 MB. Location details in photos are
            removed.
          </p>
          {pictureError && <Feedback error>{pictureError}</Feedback>}
        </div>
      </div>
      <dl>
        {(
          [
            ['displayName', 'Name', displayName],
            ['username', 'Username', `@${username}`],
          ] as const
        ).map(([kind, label, shown]) => (
          <div key={kind}>
            <dt>{label}</dt>
            <dd
              className="icon-line"
              style={{ justifyContent: 'space-between' }}
            >
              <span>{shown}</span>
              <Button
                variant="ghost"
                type="button"
                aria-label={`Change ${label.toLowerCase()}`}
                onClick={() => open(kind)}
              >
                <Pencil size={15} aria-hidden /> Change
              </Button>
            </dd>
          </div>
        ))}
      </dl>
      <Dialog
        open={editing !== null}
        onClose={() => !busy && setEditing(null)}
        title={editing ? copy[editing].title : ''}
        description={editing ? copy[editing].description : undefined}
      >
        {editing && (
          <form className="grid gap-4" onSubmit={save} noValidate>
            <Field
              id={`edit-${editing}`}
              label={copy[editing].label}
              value={value}
              autoCapitalize={editing === 'username' ? 'none' : undefined}
              spellCheck={editing === 'username' ? false : undefined}
              maxLength={editing === 'username' ? 20 : 80}
              onChange={(event) => setValue(event.target.value)}
              disabled={busy}
              data-autofocus
            />
            {error && <Feedback error>{error}</Feedback>}
            <div className="dialog-foot">
              <Button
                variant="ghost"
                type="button"
                onClick={() => setEditing(null)}
                disabled={busy}
              >
                Cancel
              </Button>
              <Button variant="accent" type="submit" loading={busy}>
                Save
              </Button>
            </div>
          </form>
        )}
      </Dialog>
    </section>
  );
}
