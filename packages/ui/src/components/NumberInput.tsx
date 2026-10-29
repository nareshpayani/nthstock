import { formatInr, parseRupeesToPaise } from '@nthstock/utils';
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
} from 'react';
import { IconMinus, IconPlus } from '../icons/icons.js';
import { cn } from '../lib/cn.js';
import { useTouchTargets } from '../lib/touchTargets.js';
import { useFieldControl } from './Field.js';
import { inputFrameClass } from './Input.js';

export type NumberInputProps = {
  /** "integer" for quantities; "price" for rupee amounts held as integer paise. */
  mode: 'integer' | 'price';
  /** Integer value (quantity or paise). null when empty or invalid. */
  value: number | null;
  onChange: (value: number | null) => void;
  /** Step in the value's unit: 1 share, or the tick size in paise (default 5 = ₹0.05). */
  step?: number;
  min?: number;
  max?: number;
  id?: string;
  name?: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  'aria-label'?: string;
  /** What the − / + buttons change, for their names ("Decrease trail"); rupees or quantity by default. */
  stepLabel?: string;
};

/** A held − / + repeats after this long (A15), first slowly, then faster. */
export const HOLD_DELAY_MS = 400;
const REPEAT_START_MS = 140;
const REPEAT_MIN_MS = 40;
/** After this many repeats a held quantity steps 5 at a time, then 10 (prices keep one tick). */
const BIGGER_AFTER = 15;

/** The wait before the next repeat and the step size, after `count` repeats so far. */
export function holdRepeat(
  count: number,
  mode: 'integer' | 'price',
): { waitMs: number; times: number } {
  const waitMs = Math.max(REPEAT_MIN_MS, REPEAT_START_MS * 0.85 ** count);
  const times =
    mode === 'price' ? 1 : count >= BIGGER_AFTER * 2 ? 10 : count >= BIGGER_AFTER ? 5 : 1;
  return { waitMs, times };
}

function toText(mode: NumberInputProps['mode'], value: number | null): string {
  if (value === null) return '';
  return mode === 'price' ? formatInr(value).replace('₹', '').replaceAll(',', '') : String(value);
}

function parse(mode: NumberInputProps['mode'], text: string): number | null {
  if (mode === 'price') return parseRupeesToPaise(text);
  return /^\d+$/.test(text.trim()) ? Number(text.trim()) : null;
}

/**
 * Numeric text input with − / + steppers and ↑/↓ keys. Prices snap to the tick on blur, so the
 * value is always an integer multiple of `step` paise; money never becomes a float.
 */
export function NumberInput({
  mode,
  value,
  onChange,
  step = mode === 'price' ? 5 : 1,
  min = mode === 'price' ? step : 1,
  max = Number.MAX_SAFE_INTEGER,
  disabled,
  className,
  stepLabel,
  ...rest
}: NumberInputProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const control = useFieldControl(rest.id ? { id: rest.id } : {});
  const clamp = (next: number) => Math.min(max, Math.max(min, next));
  const snap = (next: number) => clamp(Math.round(next / step) * step);

  // The value a held stepper builds on: the parent's re-render lags the repeats.
  const valueRef = useRef(value);
  useLayoutEffect(() => {
    valueRef.current = value;
  }, [value]);
  // The latest props, so a hold that outlives a render never steps with stale ones.
  const latest = useRef({ onChange, min, max, step, disabled, mode });
  useLayoutEffect(() => {
    latest.current = { onChange, min, max, step, disabled, mode };
  });
  const stepBy = (direction: 1 | -1, times = 1) => {
    const live = latest.current;
    if (live.disabled) {
      stopHold();
      return false;
    }
    const liveClamp = (n: number) => Math.min(live.max, Math.max(live.min, n));
    const current = valueRef.current;
    const next =
      current === null
        ? live.min
        : liveClamp(Math.round(current / live.step) * live.step + direction * live.step * times);
    valueRef.current = next;
    live.onChange(next);
    setDraft(null);
    return next !== current && next !== (direction > 0 ? live.max : live.min);
  };

  // Hold to repeat (A15): a press steps once, and holding keeps stepping, faster the longer it is
  // held. The click that follows a pointer press is ignored; a keyboard or test click steps once.
  const holdRef = useRef<number | undefined>(undefined);
  const stopHold = () => {
    window.clearTimeout(holdRef.current);
    holdRef.current = undefined;
  };
  useEffect(() => stopHold, []);
  useEffect(() => {
    if (disabled) stopHold();
  }, [disabled]);
  const directionOf = (button: HTMLButtonElement): 1 | -1 =>
    button.dataset.direction === 'up' ? 1 : -1;
  const startHold = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    const direction = directionOf(event.currentTarget);
    stopHold();
    if (!stepBy(direction)) return;
    let count = 0;
    const repeat = () => {
      const { waitMs, times } = holdRepeat(count, mode);
      holdRef.current = window.setTimeout(() => {
        count += 1;
        if (stepBy(direction, times)) repeat();
        else stopHold();
      }, waitMs);
    };
    holdRef.current = window.setTimeout(repeat, HOLD_DELAY_MS - REPEAT_START_MS);
  };
  const onStepClick = (event: MouseEvent<HTMLButtonElement>) => {
    if (event.detail === 0) stepBy(directionOf(event.currentTarget));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      stepBy(event.key === 'ArrowUp' ? 1 : -1);
    }
  };

  const touch = useTouchTargets();
  const unit = stepLabel ?? (mode === 'price' ? 'rupees' : 'quantity');
  const stepperClass = cn(
    'flex shrink-0 items-center justify-center rounded-sm text-ink-muted hover:bg-canvas disabled:opacity-40',
    touch ? 'size-11' : 'size-8',
  );

  return (
    <div className={cn(inputFrameClass, 'px-1', touch && 'h-12', className)}>
      <button
        type="button"
        tabIndex={-1}
        aria-label={`Decrease ${unit}`}
        disabled={disabled || (value !== null && value <= min)}
        data-direction="down"
        onClick={onStepClick}
        onPointerDown={startHold}
        onPointerUp={stopHold}
        onPointerLeave={stopHold}
        onPointerCancel={stopHold}
        onContextMenu={(event) => event.preventDefault()}
        className={cn(stepperClass, 'touch-none select-none')}
      >
        <IconMinus size={16} />
      </button>
      <input
        {...rest}
        {...control}
        type="text"
        inputMode={mode === 'price' ? 'decimal' : 'numeric'}
        autoComplete="off"
        disabled={disabled}
        value={draft ?? toText(mode, value)}
        onChange={(event) => {
          setDraft(event.target.value);
          onChange(parse(mode, event.target.value));
        }}
        onBlur={() => {
          setDraft(null);
          if (value !== null) {
            const snapped = snap(value);
            if (snapped !== value) onChange(snapped);
          }
        }}
        onKeyDown={onKeyDown}
        className="min-w-0 flex-1 self-stretch bg-transparent text-center font-mono tabular-nums outline-none"
      />
      <button
        type="button"
        tabIndex={-1}
        aria-label={`Increase ${unit}`}
        disabled={disabled || (value !== null && value >= max)}
        data-direction="up"
        onClick={onStepClick}
        onPointerDown={startHold}
        onPointerUp={stopHold}
        onPointerLeave={stopHold}
        onPointerCancel={stopHold}
        onContextMenu={(event) => event.preventDefault()}
        className={cn(stepperClass, 'touch-none select-none')}
      >
        <IconPlus size={16} />
      </button>
    </div>
  );
}
