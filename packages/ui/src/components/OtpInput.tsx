import { useRef, type ClipboardEvent, type KeyboardEvent } from 'react';
import { cn } from '../lib/cn.js';
import { useFieldControl } from './Field.js';

export type OtpInputProps = {
  value: string;
  onChange: (value: string) => void;
  /** Called once all boxes are filled. */
  onComplete?: (value: string) => void;
  length?: number;
  disabled?: boolean;
  /** Accessible name for the group, e.g. "One-time password". */
  label?: string;
  className?: string;
};

/**
 * One box per digit. Typing advances, Backspace goes back, and pasting a code fills every box.
 * The first box takes the Field's id so the label and error are wired to it.
 */
export function OtpInput({
  value,
  onChange,
  onComplete,
  length = 6,
  disabled,
  label = 'One-time password',
  className,
}: OtpInputProps) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const control = useFieldControl();
  const digits = Array.from({ length }, (_, index) => value[index] ?? '');

  const commit = (next: string) => {
    const clean = next.replace(/\D/g, '').slice(0, length);
    onChange(clean);
    if (clean.length === length) onComplete?.(clean);
    return clean;
  };

  const focusBox = (index: number) =>
    refs.current[Math.max(0, Math.min(length - 1, index))]?.focus();

  const setDigit = (index: number, digit: string) => {
    const chars = digits.slice();
    chars[index] = digit;
    commit(chars.join(''));
  };

  const onKeyDown = (index: number, event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Backspace' && !digits[index]) {
      event.preventDefault();
      setDigit(index - 1, '');
      focusBox(index - 1);
    } else if (event.key === 'ArrowLeft') {
      focusBox(index - 1);
    } else if (event.key === 'ArrowRight') {
      focusBox(index + 1);
    }
  };

  const onPaste = (event: ClipboardEvent<HTMLInputElement>) => {
    event.preventDefault();
    const pasted = commit(event.clipboardData.getData('text'));
    focusBox(pasted.length);
  };

  return (
    <div role="group" aria-label={label} className={cn('flex gap-2', className)}>
      {digits.map((digit, index) => (
        <input
          // Boxes are positional and never reorder.
          key={index}
          ref={(element) => {
            refs.current[index] = element;
          }}
          {...(index === 0 ? control : { 'aria-invalid': control['aria-invalid'] })}
          aria-label={`Digit ${String(index + 1)} of ${String(length)}`}
          inputMode="numeric"
          autoComplete={index === 0 ? 'one-time-code' : 'off'}
          maxLength={1}
          disabled={disabled}
          value={digit}
          onChange={(event) => {
            const typed = event.target.value.replace(/\D/g, '');
            if (typed.length > 1) {
              const pasted = commit(typed);
              focusBox(pasted.length);
              return;
            }
            setDigit(index, typed);
            if (typed) focusBox(index + 1);
          }}
          onKeyDown={(event) => onKeyDown(index, event)}
          onPaste={onPaste}
          onFocus={(event) => event.target.select()}
          className="size-11 rounded-md border border-line bg-surface text-center font-mono text-lg text-ink outline-none focus:border-brand focus:ring-3 focus:ring-brand-soft aria-[invalid=true]:border-down disabled:opacity-50"
        />
      ))}
    </div>
  );
}
