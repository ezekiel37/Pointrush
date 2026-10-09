'use client';
import { useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { LoaderCircle, Upload } from 'lucide-react';
import { accepts, uploadError, uploadFile } from '@/lib/files';
import type { Purpose, Uploaded } from '@/lib/files';

// A button that opens the file picker, uploads, and reports the result.
export function FileButton({
  purpose,
  onUploaded,
  onError,
  disabled = false,
  children,
  variant = 'outline',
}: {
  purpose: Purpose;
  onUploaded: (file: Uploaded, original: File) => void;
  onError: (message: string) => void;
  disabled?: boolean;
  children: ReactNode;
  variant?: 'outline' | 'ghost';
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <input
        ref={input}
        type="file"
        accept={accepts[purpose]}
        hidden
        onChange={async (event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (!file) return;
          setBusy(true);
          onError('');
          try {
            onUploaded(await uploadFile(purpose, file), file);
          } catch (error) {
            onError(uploadError(error));
          } finally {
            setBusy(false);
          }
        }}
      />
      <button
        type="button"
        className={`button button-${variant}`}
        disabled={disabled || busy}
        aria-busy={busy || undefined}
        onClick={() => input.current?.click()}
      >
        {busy ? (
          <LoaderCircle className="spinner" size={17} aria-hidden />
        ) : (
          <Upload size={17} aria-hidden />
        )}
        {busy ? 'Uploading…' : children}
      </button>
    </>
  );
}
