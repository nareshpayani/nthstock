import { cn } from '../lib/cn.js';

/**
 * A tick that draws itself in 280 ms, in currentColor: the "done" mark a button shows once its
 * action has succeeded. Decorative; the outcome is also said in words (a toast or a status).
 * With reduced motion it appears drawn.
 */
export function SuccessCheck({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      data-testid="success-check"
      className={cn('nth-check size-5', className)}
    >
      <path d="m5 12.5 4.5 4.5L19 7.5" pathLength={1} className="nth-check-path" />
    </svg>
  );
}
