'use client';
import { useRef, useState } from 'react';
import { FileText, X } from 'lucide-react';
import { Form } from '@/components/ui/form';
import { Button } from '@/components/ui/button';
import { Feedback } from '@/components/ui/feedback';
import { FileButton } from '@/components/ui/file-button';
import type { Uploaded } from '@/lib/files';

export type Attachment = Uploaded & { name: string; preview: string | null };
export function EvidenceForm({
  value,
  onChange,
  onSubmit,
  label,
  fieldLabel,
  help,
  limit,
  busy,
  locked,
  attachments,
  onAttachments,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  label: string;
  fieldLabel?: string;
  help?: string;
  limit: number;
  busy: boolean;
  locked: boolean;
  // Up to 3 photos or PDFs; omitted where files do not apply (appeals).
  attachments?: Attachment[];
  onAttachments?: (files: Attachment[]) => void;
}) {
  const [fileError, setFileError] = useState('');
  const field = useRef<HTMLTextAreaElement>(null);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState(false);
  return (
    <Form
      noValidate
      aria-busy={busy}
      onSubmit={(event) => {
        event.preventDefault();
        if (!value.trim() || value.trim().length > limit) {
          setError(
            `Enter between 1 and ${limit.toLocaleString('en-NG')} characters.`,
          );
          field.current?.focus();
          return;
        }
        setError('');
        onSubmit();
      }}
    >
      <div className="field">
        <label htmlFor="work-evidence">{fieldLabel ?? label}</label>
        <textarea
          ref={field}
          id="work-evidence"
          className="input work-evidence resize-none"
          rows={expanded ? 18 : 7}
          value={value}
          readOnly={locked}
          maxLength={limit}
          aria-invalid={Boolean(error)}
          aria-describedby="work-evidence-help"
          onChange={(e) => onChange(e.target.value)}
        />
        <p
          id="work-evidence-help"
          className={error ? 'field-help field-error' : 'field-help'}
        >
          {error ||
            `${value.length.toLocaleString('en-NG')} / ${limit.toLocaleString('en-NG')} characters.${help ? ` ${help}` : ''}`}
        </p>
        <Button
          type="button"
          variant="ghost"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? 'Reduce writing area' : 'Expand writing area'}
        </Button>
      </div>
      {attachments && onAttachments && (
        <div className="grid gap-2">
          {attachments.length > 0 && (
            <ul className="evidence-files" aria-label="Files to send">
              {attachments.map((file, index) => (
                <li key={file.id} className="evidence-chip">
                  {file.preview ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={file.preview} alt="" />
                  ) : (
                    <FileText size={20} aria-hidden />
                  )}
                  <span className="truncate">{file.name}</span>
                  {!locked && (
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={`Remove ${file.name}`}
                      onClick={() =>
                        onAttachments(attachments.filter((_, i) => i !== index))
                      }
                    >
                      <X size={16} aria-hidden />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {!locked && attachments.length < 3 && (
            <FileButton
              purpose="evidence"
              variant="ghost"
              onError={setFileError}
              onUploaded={(file, original) =>
                onAttachments([
                  ...attachments,
                  {
                    ...file,
                    name: original.name,
                    preview: file.contentType.startsWith('image/')
                      ? URL.createObjectURL(original)
                      : null,
                  },
                ])
              }
            >
              Attach a photo or PDF ({attachments.length}/3)
            </FileButton>
          )}
          <p className="small-note" style={{ margin: 0 }}>
            Up to 3 files, 5 MB each. Location details in photos are removed.
            Files are kept for 90 days after the decision.
          </p>
          {fileError && <Feedback error>{fileError}</Feedback>}
        </div>
      )}
      <Button type="submit" loading={busy}>
        {busy ? 'Sending…' : locked ? 'Retry same submission' : label}
      </Button>
    </Form>
  );
}
