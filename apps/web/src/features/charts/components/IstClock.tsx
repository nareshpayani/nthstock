import { cn } from '@nthstock/ui';
import { formatIstTimeSeconds } from '@nthstock/utils';
import { useEffect, useState } from 'react';
import { strings } from '../strings';

/**
 * The time in IST, to the second, beside the chart controls (NSTOCK-0463). Hidden from screen
 * readers: a ticking clock would announce itself every second, and they have their own.
 */
export function IstClock({ className }: { className?: string }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);
  return (
    <span
      aria-hidden="true"
      data-testid="ist-clock"
      className={cn('text-label whitespace-nowrap text-ink-muted tabular-nums', className)}
    >
      {formatIstTimeSeconds(now)} {strings.clock.suffix}
    </span>
  );
}
