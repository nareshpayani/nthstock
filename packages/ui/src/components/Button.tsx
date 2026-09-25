import { cva, type VariantProps } from 'class-variance-authority';
import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react';
import { cn } from '../lib/cn.js';
import { Spinner } from './Spinner.js';

export const buttonVariants = cva(
  'inline-flex shrink-0 items-center justify-center gap-2 font-semibold whitespace-nowrap transition-colors duration-(--nth-duration-flash) select-none disabled:cursor-not-allowed disabled:opacity-50 aria-busy:cursor-progress',
  {
    variants: {
      variant: {
        primary: 'bg-brand text-surface hover:bg-brand/90 active:bg-brand/80',
        buy: 'bg-up text-surface hover:bg-up/90 active:bg-up/80',
        sell: 'bg-down text-surface hover:bg-down/90 active:bg-down/80',
        secondary: 'border border-line bg-surface text-ink hover:bg-canvas',
        ghost: 'bg-transparent text-brand hover:bg-brand-soft',
      },
      size: {
        sm: 'h-8 rounded-md px-3 text-label',
        md: 'h-10 rounded-md px-4 text-body',
        lg: 'h-12 rounded-md px-6 text-lg',
      },
      block: { true: 'w-full', false: '' },
    },
    defaultVariants: { variant: 'primary', size: 'md', block: false },
  },
);

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & {
    /** Shows a spinner, sets aria-busy and blocks clicks while an action runs. */
    loading?: boolean;
    /** Icon shown before the label. */
    icon?: ReactNode;
    ref?: Ref<HTMLButtonElement>;
  };

export function Button({
  variant,
  size,
  block,
  loading = false,
  icon,
  disabled,
  className,
  children,
  type = 'button',
  onClick,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(buttonVariants({ variant, size, block }), className)}
      disabled={disabled}
      aria-busy={loading || undefined}
      onClick={loading ? (event) => event.preventDefault() : onClick}
      {...rest}
    >
      {loading ? <Spinner /> : icon}
      {children}
    </button>
  );
}
