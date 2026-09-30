'use client';
import { useState } from 'react';
import type { ComponentProps } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { Input } from './input';
import { Button } from './button';
export function Field({
  label,
  hint,
  error,
  id,
  type,
  ...props
}: ComponentProps<typeof Input> & {
  id: string;
  label: string;
  hint?: string;
  error?: string;
}) {
  const [visible, setVisible] = useState(false);
  const password = type === 'password';
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="input-wrap">
        <Input
          {...props}
          id={id}
          type={password && visible ? 'text' : type}
          aria-invalid={Boolean(error)}
          aria-describedby={`${id}-help`}
          className={password ? 'password-input' : undefined}
        />
        {password && (
          <Button
            type="button"
            variant="ghost"
            className="visibility"
            aria-label={
              visible
                ? `Hide ${label.toLowerCase()}`
                : `Show ${label.toLowerCase()}`
            }
            aria-pressed={visible}
            onClick={() => setVisible(!visible)}
          >
            {visible ? (
              <EyeOff size={19} aria-hidden />
            ) : (
              <Eye size={19} aria-hidden />
            )}
          </Button>
        )}
      </div>
      <p
        id={`${id}-help`}
        className={error ? 'field-help field-error' : 'field-help'}
      >
        {error || hint || ' '}
      </p>
    </div>
  );
}
