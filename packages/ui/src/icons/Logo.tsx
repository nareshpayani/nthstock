import { cn } from '../lib/cn.js';

export type LogoProps = {
  /** Show the "nthstock" wordmark beside the mark. Defaults to true. */
  withWordmark?: boolean;
  className?: string;
};

/**
 * nthstock logo: a brand-blue tile with "n" and a marigold superscript "th", then the wordmark.
 * The whole logo has one accessible name.
 */
export function Logo({ withWordmark = true, className }: LogoProps) {
  return (
    <span
      className={cn('inline-flex items-center gap-2', className)}
      role="img"
      aria-label="nthstock"
    >
      <svg width="28" height="28" viewBox="0 0 28 28" aria-hidden="true" focusable="false">
        <rect width="28" height="28" rx="7" className="fill-brand" />
        <text
          x="6"
          y="19.5"
          className="fill-surface font-mono"
          fontSize="15"
          fontWeight="600"
          letterSpacing="-0.5"
        >
          n
        </text>
        <text x="15" y="12.5" className="fill-marigold font-mono" fontSize="8.5" fontWeight="600">
          th
        </text>
      </svg>
      {withWordmark ? (
        <span aria-hidden="true" className="text-title font-semibold tracking-tight text-ink">
          nth<span className="text-brand">stock</span>
        </span>
      ) : null}
    </span>
  );
}
