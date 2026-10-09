'use client';
import { useEffect, useId, useRef } from 'react';
import type { ReactNode } from 'react';
import { TriangleAlert, X } from 'lucide-react';
import { Button } from './button';

// A modal on the native <dialog>: the browser traps focus, closes on Escape
// and returns focus to the button that opened it. On phones it rises from
// the bottom as a sheet.
export function Dialog({
  open,
  onClose,
  title,
  description,
  icon,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  icon?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      // The browser focuses the first button; a form field can ask for focus.
      dialog.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    }
    if (!open && dialog.open) dialog.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className="dialog"
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        // A tap on the backdrop (outside the panel) closes it.
        if (event.target === event.currentTarget) onClose();
      }}
    >
      {open && (
        <div className="dialog-panel">
          <div className="dialog-head">
            {icon && (
              <span className="dialog-icon" aria-hidden>
                {icon}
              </span>
            )}
            <div className="dialog-text">
              <h2 id={titleId}>{title}</h2>
              {description && <p id={descriptionId}>{description}</p>}
            </div>
            <button
              type="button"
              className="icon-button"
              aria-label="Close"
              onClick={onClose}
            >
              <X size={18} aria-hidden />
            </button>
          </div>
          {children}
          {footer && <div className="dialog-foot">{footer}</div>}
        </div>
      )}
    </dialog>
  );
}

// Asks before an action that cannot be undone.
export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel,
  busyLabel,
  cancelLabel = 'Cancel',
  busy = false,
  danger = false,
  children,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description?: ReactNode;
  confirmLabel: string;
  busyLabel?: string;
  cancelLabel?: string;
  busy?: boolean;
  danger?: boolean;
  children?: ReactNode;
}) {
  return (
    <Dialog
      open={open}
      onClose={() => !busy && onClose()}
      title={title}
      description={description}
      icon={danger ? <TriangleAlert size={20} /> : undefined}
      footer={
        <>
          <Button
            type="button"
            variant="ghost"
            onClick={onClose}
            disabled={busy}
          >
            {cancelLabel}
          </Button>
          <Button
            type="button"
            variant={danger ? 'danger' : 'accent'}
            loading={busy}
            onClick={onConfirm}
          >
            {busy && busyLabel ? busyLabel : confirmLabel}
          </Button>
        </>
      }
    >
      {children}
    </Dialog>
  );
}
