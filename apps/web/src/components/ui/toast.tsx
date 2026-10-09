'use client';
import { useEffect, useSyncExternalStore } from 'react';
import { CircleAlert, CircleCheck } from 'lucide-react';

type Toast = { id: number; text: string; error: boolean };
let toasts: Toast[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());

// A short note that something worked (or failed), shown at the bottom of
// the screen for a few seconds. Important errors stay inline with the form.
export function toast(text: string, options: { error?: boolean } = {}) {
  toasts = [...toasts, { id: nextId++, text, error: Boolean(options.error) }];
  emit();
}
function dismiss(id: number) {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
const empty: Toast[] = [];

function Item({ item }: { item: Toast }) {
  useEffect(() => {
    const timer = setTimeout(() => dismiss(item.id), 4000);
    return () => clearTimeout(timer);
  }, [item.id]);
  return (
    <div className={`toast ${item.error ? 'toast-error' : ''}`}>
      {item.error ? (
        <CircleAlert size={18} aria-hidden />
      ) : (
        <CircleCheck size={18} aria-hidden />
      )}
      {item.text}
    </div>
  );
}

export function Toaster() {
  const items = useSyncExternalStore(
    subscribe,
    () => toasts,
    () => empty,
  );
  return (
    <div className="toaster" role="status" aria-live="polite">
      {items.map((item) => (
        <Item key={item.id} item={item} />
      ))}
    </div>
  );
}
