import { formatInr, parseRupeesToPaise } from '@nthstock/utils';
import { useState, type KeyboardEvent } from 'react';
import { IconMinus, IconPlus } from '../icons/icons.js';
import { cn } from '../lib/cn.js';
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
};

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
  ...rest
}: NumberInputProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const control = useFieldControl(rest.id ? { id: rest.id } : {});
  const clamp = (next: number) => Math.min(max, Math.max(min, next));
  const snap = (next: number) => clamp(Math.round(next / step) * step);

  const stepBy = (direction: 1 | -1) => {
    onChange(value === null ? min : clamp(snap(value) + direction * step));
    setDraft(null);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      stepBy(event.key === 'ArrowUp' ? 1 : -1);
    }
  };

  const unit = mode === 'price' ? 'rupees' : 'quantity';

  return (
    <div className={cn(inputFrameClass, 'px-1', className)}>
      <button
        type="button"
        tabIndex={-1}
        aria-label={`Decrease ${unit}`}
        disabled={disabled || (value !== null && value <= min)}
        onClick={() => stepBy(-1)}
        className="flex size-8 items-center justify-center rounded-sm text-ink-muted hover:bg-canvas disabled:opacity-40"
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
        className="min-w-0 flex-1 bg-transparent text-center font-mono tabular-nums outline-none"
      />
      <button
        type="button"
        tabIndex={-1}
        aria-label={`Increase ${unit}`}
        disabled={disabled || (value !== null && value >= max)}
        onClick={() => stepBy(1)}
        className="flex size-8 items-center justify-center rounded-sm text-ink-muted hover:bg-canvas disabled:opacity-40"
      >
        <IconPlus size={16} />
      </button>
    </div>
  );
}
