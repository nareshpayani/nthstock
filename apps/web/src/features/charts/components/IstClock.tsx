import { cn } from '@nthstock/ui';
import { formatIstTime, formatIstTimeSeconds } from '@nthstock/utils';
import { useEffect, useState } from 'react';
import { strings } from '../strings';

/**
 * The time in IST, to the second, beside the chart controls (NSTOCK-0463). The ticking digits are
 * hidden from screen readers; they get the time to the minute in plain text, not a live region, so
 * it is read when reached and never announced on a tick.
 */
export function IstClock({ className }: { className?: string }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);
  return (
    <span className={cn('whitespace-nowrap', className)}>
      <span
        aria-hidden="true"
        data-testid="ist-clock"
        className="font-mono text-label text-ink-muted tabular-nums"
      >
        {formatIstTimeSeconds(now)} {strings.clock.suffix}
      </span>
      <span data-testid="ist-clock-label" className="sr-only">
        {strings.clock.label(formatIstTime(now))}
      </span>
    </span>
  );
}
