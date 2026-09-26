import { useEffect, useState } from 'react';

/**
 * Whole seconds left until `deadline` (epoch ms), ticking down to 0; never more than `totalSec`.
 * Computed from the clock rather than counted, so a throttled background tab stays correct.
 */
export function useCountdown(deadline: number, totalSec: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (Date.now() >= deadline) return;
    const id = setInterval(() => {
      const at = Date.now();
      setNow(at);
      if (at >= deadline) clearInterval(id);
    }, 250);
    return () => clearInterval(id);
  }, [deadline]);
  return Math.max(0, Math.min(totalSec, Math.ceil((deadline - now) / 1000)));
}
