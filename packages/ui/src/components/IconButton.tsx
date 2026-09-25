import { cva, type VariantProps } from 'class-variance-authority';
import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react';
import { cn } from '../lib/cn.js';
import { Spinner } from './Spinner.js';

export const iconButtonVariants = cva(
  'inline-flex shrink-0 items-center justify-center rounded-md transition-colors duration-(--nth-duration-flash) disabled:cursor-not-allowed disabled:opacity-50',
  {
    variants: {
      variant: {
        ghost: 'text-ink-muted hover:bg-canvas hover:text-ink',
        secondary: 'border border-line bg-surface text-ink hover:bg-canvas',
        primary: 'bg-brand text-surface hover:bg-brand/90',
      },
      size: { sm: 'size-8', md: 'size-10' },
    },
    defaultVariants: { variant: 'ghost', size: 'md' },
  },
);

export type IconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> &
  VariantProps<typeof iconButtonVariants> & {
    /** Required accessible name; icon-only buttons have no visible text. */
    label: string;
    icon: ReactNode;
    loading?: boolean;
    ref?: Ref<HTMLButtonElement>;
  };

export function IconButton({
  label,
  icon,
  variant,
  size,
  loading = false,
  className,
  type = 'button',
  onClick,
  ...rest
}: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      aria-busy={loading || undefined}
      className={cn(iconButtonVariants({ variant, size }), className)}
      onClick={loading ? (event) => event.preventDefault() : onClick}
      {...rest}
    >
      {loading ? <Spinner /> : icon}
    </button>
  );
}
