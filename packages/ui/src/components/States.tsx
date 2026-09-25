import type { ReactNode } from 'react';
import { IconAlert, IconInbox, IconRefresh } from '../icons/icons.js';
import { cn } from '../lib/cn.js';
import { Button } from './Button.js';

export type EmptyStateProps = {
  title: ReactNode;
  description?: ReactNode;
  /** Defaults to an inbox icon. */
  icon?: ReactNode;
  /** Call to action, e.g. an "Add stock" button. */
  action?: ReactNode;
  className?: string;
};

export function EmptyState({ title, description, icon, action, className }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center gap-2 px-4 py-8 text-center', className)}>
      <span className="mb-1 flex size-12 items-center justify-center rounded-pill bg-brand-soft text-brand">
        {icon ?? <IconInbox size={24} />}
      </span>
      <p className="text-lg font-semibold text-ink">{title}</p>
      {description ? <p className="max-w-xs text-body text-ink-muted">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

export type ErrorStateProps = {
  title?: ReactNode;
  description?: ReactNode;
  /** Shows a Retry button that calls this. */
  onRetry?: () => void;
  retryLabel?: string;
  className?: string;
};

/** Inline error with an optional retry, announced through role="alert". */
export function ErrorState({
  title = 'Something went wrong',
  description = 'Please try again.',
  onRetry,
  retryLabel = 'Retry',
  className,
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      className={cn('flex flex-col items-center gap-2 px-4 py-8 text-center', className)}
    >
      <span className="mb-1 flex size-12 items-center justify-center rounded-pill bg-down-soft text-down">
        <IconAlert size={24} />
      </span>
      <p className="text-lg font-semibold text-ink">{title}</p>
      {description ? <p className="max-w-xs text-body text-ink-muted">{description}</p> : null}
      {onRetry ? (
        <Button
          variant="secondary"
          size="sm"
          icon={<IconRefresh size={16} />}
          onClick={onRetry}
          className="mt-2"
        >
          {retryLabel}
        </Button>
      ) : null}
    </div>
  );
}
