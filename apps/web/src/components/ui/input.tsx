import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';
// Adapted from the shadcn/ui Input (MIT), using canonical input tokens.
export function Input({ className, ...props }: ComponentProps<'input'>) {
  return (
    <input data-slot="input" className={cn('input', className)} {...props} />
  );
}
