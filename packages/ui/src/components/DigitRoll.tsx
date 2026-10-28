import { useState } from 'react';
import { cn } from '../lib/cn.js';

export type DigitRollProps = {
  /** The formatted value, e.g. "₹1,523.85". Characters are compared from the right. */
  value: string;
  className?: string | undefined;
};

type Seen = { value: string; previous: string; version: number };

/** The number a formatted value stands for, for the roll direction. NaN when there is none. */
const numeric = (text: string) => Number(text.replace(/[^\d.-]/g, ''));

/**
 * A formatted number whose changed digits roll (SPEC-CR-1 §5.6): unchanged characters stay still;
 * a changed digit rolls in from below when the value went up and from above when it went down, with
 * a brief 1 px underline. No colour flash (PR #231). Under reduced motion it is a plain swap
 * (styles.css). The text content is exactly `value`, so screen readers and tests read it whole.
 */
export function DigitRoll({ value, className }: DigitRollProps) {
  const [seen, setSeen] = useState<Seen>({ value, previous: value, version: 0 });
  if (seen.value !== value) {
    setSeen({ value, previous: seen.value, version: seen.version + 1 });
  }
  const { previous, version } = seen.value === value ? seen : { previous: value, version: 0 };
  const shift = value.length - previous.length;
  const up = numeric(value) >= numeric(previous);
  return (
    <span className={cn('tabular-nums', className)}>
      {[...value].map((char, index) => {
        const before = previous[index - shift];
        const rolled = version > 0 && /\d/.test(char) && before !== char;
        return (
          <span
            // A new key per change restarts the roll on the same position.
            key={rolled ? `${String(index)}-${String(version)}` : String(index)}
            data-rolled={rolled || undefined}
            className={rolled ? (up ? 'nth-digit-up' : 'nth-digit-down') : undefined}
          >
            {char}
          </span>
        );
      })}
    </span>
  );
}
