import { cn } from '../lib/cn.js';

export type PulseDotProps = {
  /** `brand` for unread, `down` for an alert badge. */
  tone?: 'brand' | 'down';
  className?: string | undefined;
};

const fill = { brand: 'bg-brand', down: 'bg-down' } as const;

/**
 * An 8 px dot that sends out a fading ring, like a radar ping (NSTOCK-0462), for something new:
 * an unread notification. Decorative: the caller says "Unread" in text. Under reduced motion the
 * ring stays hidden and only the dot shows.
 */
export function PulseDot({ tone = 'brand', className }: PulseDotProps) {
  return (
    <span aria-hidden="true" className={cn('relative inline-flex size-2', className)}>
      <span
        data-part="ripple"
        className={cn(
          'absolute inset-0 animate-ripple rounded-pill opacity-0 motion-reduce:hidden',
          fill[tone],
        )}
      />
      <span className={cn('relative size-2 rounded-pill', fill[tone])} />
    </span>
  );
}
