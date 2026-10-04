'use client';
import { useRef, useState } from 'react';
import { Form } from '@/components/ui/form';
import { Button } from '@/components/ui/button';
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
}) {
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
            `${value.length.toLocaleString('en-NG')} / ${limit.toLocaleString('en-NG')} characters. ${help ?? 'Text only; file uploads are not available yet.'}`}
        </p>
        <Button
          type="button"
          variant="ghost"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? 'Reduce writing area' : 'Expand writing area'}
        </Button>
      </div>
      <Button type="submit" disabled={busy}>
        {busy ? 'Sending…' : locked ? 'Retry same submission' : label}
      </Button>
    </Form>
  );
}
