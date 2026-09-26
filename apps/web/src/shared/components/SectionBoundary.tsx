import { ErrorState, cn } from '@nthstock/ui';
import { QueryErrorResetBoundary } from '@tanstack/react-query';
import { Component, type ErrorInfo, type ReactNode } from 'react';

export type SectionBoundaryProps = {
  /** Names the failed section for screen readers, e.g. "Market movers". */
  label: string;
  title: string;
  description: string;
  retryLabel: string;
  className?: string;
  children: ReactNode;
};

type BoundaryProps = SectionBoundaryProps & { onReset: () => void };
type BoundaryState = { failed: boolean };

class Boundary extends Component<BoundaryProps, BoundaryState> {
  override state: BoundaryState = { failed: false };

  static getDerivedStateFromError(): BoundaryState {
    return { failed: true };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo) {
    // Surfaced for developers and, later, Sentry; the user sees the inline error below.
    console.error('Dashboard section failed', error, info.componentStack);
  }

  override render() {
    const { label, title, description, retryLabel, className, onReset, children } = this.props;
    if (!this.state.failed) return children;
    return (
      <section
        aria-label={label}
        className={cn('rounded-lg border border-line bg-surface', className)}
      >
        <ErrorState
          title={title}
          description={description}
          retryLabel={retryLabel}
          onRetry={() => {
            onReset();
            this.setState({ failed: false });
          }}
        />
      </section>
    );
  }
}

/**
 * Error isolation for one page section (T-099): if the section throws while rendering, only that
 * section is replaced by an inline ErrorState with a retry; the rest of the page keeps working.
 * Retry also clears any query errors thrown inside it, so the section refetches.
 */
export function SectionBoundary(props: SectionBoundaryProps) {
  return (
    <QueryErrorResetBoundary>
      {({ reset }) => <Boundary {...props} onReset={reset} />}
    </QueryErrorResetBoundary>
  );
}
