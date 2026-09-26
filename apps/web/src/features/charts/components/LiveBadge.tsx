import { cn } from '@nthstock/ui';
import { strings } from '../strings';

/** "LIVE" pill: text plus a dot, so it never relies on colour. */
export function LiveBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-pill border border-line bg-down-soft px-2 py-0.5 text-label font-semibold tracking-wide text-ink uppercase',
        className,
      )}
      title={strings.liveLabel}
    >
      <span aria-hidden="true" className="size-2 rounded-pill bg-down motion-safe:animate-pulse" />
      {strings.live}
      <span className="sr-only">{`: ${strings.liveLabel}`}</span>
    </span>
  );
}
