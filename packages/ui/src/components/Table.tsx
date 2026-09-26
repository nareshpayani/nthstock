import type { HTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from 'react';
import { cn } from '../lib/cn.js';

export function Table({ className, ...rest }: HTMLAttributes<HTMLTableElement>) {
  return (
    <div className="w-full overflow-x-auto">
      <table className={cn('w-full border-collapse text-body', className)} {...rest} />
    </div>
  );
}

export function TableHeader({ className, ...rest }: HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className={cn('sticky top-0 bg-surface', className)} {...rest} />;
}

export function TableBody(props: HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody {...props} />;
}

export function TableRow({ className, ...rest }: HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr
      className={cn('border-b border-line last:border-b-0 hover:bg-canvas', className)}
      {...rest}
    />
  );
}

type Align = { numeric?: boolean };

export function TableHead({
  className,
  numeric,
  scope = 'col',
  ...rest
}: ThHTMLAttributes<HTMLTableCellElement> & Align) {
  return (
    <th
      scope={scope}
      className={cn(
        'border-b border-line px-3 py-2 text-left text-label font-semibold text-ink-muted',
        numeric && 'text-right',
        className,
      )}
      {...rest}
    />
  );
}

/** `numeric` right-aligns and uses tabular mono figures so price columns never jitter. */
export function TableCell({
  className,
  numeric,
  ...rest
}: TdHTMLAttributes<HTMLTableCellElement> & Align) {
  return (
    <td
      className={cn(
        'px-3 py-2 text-ink',
        numeric && 'text-right font-mono tabular-nums',
        className,
      )}
      {...rest}
    />
  );
}
