import { cn } from '../lib/cn.js';

/** Small circular spinner in currentColor. Decorative; pair it with text or aria-busy. */
export function Spinner({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-block size-4 animate-spin rounded-pill border-2 border-current border-r-transparent',
        className,
      )}
    />
  );
}
