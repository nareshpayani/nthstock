import { cn } from '@nthstock/ui';
import { useId, type ReactNode } from 'react';

export type CardProps = {
  title?: ReactNode;
  /** Right side of the title row: tabs, a link or a badge. */
  aside?: ReactNode;
  className?: string;
  children: ReactNode;
};

/** Bordered surface card (tokens: no shadows on cards). */
export function Card({ title, aside, className, children }: CardProps) {
  const headingId = useId();
  return (
    <section
      aria-labelledby={title ? headingId : undefined}
      className={cn('rounded-lg border border-line bg-surface p-4 lg:p-5', className)}
    >
      {title || aside ? (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          {title ? (
            <h2 id={headingId} className="text-lg font-semibold text-ink">
              {title}
            </h2>
          ) : null}
          {aside}
        </div>
      ) : null}
      {children}
    </section>
  );
}
