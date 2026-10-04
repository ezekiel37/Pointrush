import type { ComponentProps } from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva } from 'class-variance-authority';
import type { VariantProps } from 'class-variance-authority';
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
    },
  },
  defaultVariants: { variant: 'default' },
});
export function Button({
  className,
  variant,
  asChild = false,
  ...props
}: ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Component = asChild ? Slot : 'button';
  return (
    <Component
      data-slot="button"
      className={cn(buttonVariants({ variant }), className)}
      {...props}
    />
  );
}
