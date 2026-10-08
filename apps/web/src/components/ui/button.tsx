import type { ComponentProps } from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva } from 'class-variance-authority';
import type { VariantProps } from 'class-variance-authority';
import { LoaderCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
// Adapted from the shadcn/ui Radix Button (MIT); shared Acticlaim tokens.
// `accent` is reserved for the single most important action on a screen.
export const buttonVariants = cva('button', {
  variants: {
    variant: {
      default: 'button-primary',
      accent: 'button-accent',
      outline: 'button-outline',
      ghost: 'button-ghost',
      danger: 'button-danger',
    },
  },
  defaultVariants: { variant: 'default' },
});
// `loading` disables the button and shows a spinner beside its busy label.
export function Button({
  className,
  variant,
  asChild = false,
  loading = false,
  disabled,
  children,
  ...props
}: ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
    loading?: boolean;
  }) {
  const Component = asChild ? Slot : 'button';
  return (
    <Component
      data-slot="button"
      className={cn(buttonVariants({ variant }), className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading && !asChild ? (
        <>
          <LoaderCircle className="spinner" aria-hidden size={18} />
          {children}
        </>
      ) : (
        children
      )}
    </Component>
  );
}
