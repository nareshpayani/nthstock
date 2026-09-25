import { RadioGroup } from 'radix-ui';
import { cn } from '../lib/cn.js';

export type SegmentOption<T extends string> = {
  value: T;
  label: string;
  /** Colour of the selected segment: brand by default, up for Buy, down for Sell. */
  tone?: 'brand' | 'up' | 'down';
};

export type SegmentedControlProps<T extends string> = {
  options: readonly SegmentOption<T>[];
  value: T;
  onValueChange: (value: T) => void;
  /** Accessible name of the group, e.g. "Order side". */
  label: string;
  size?: 'sm' | 'md';
  disabled?: boolean;
  className?: string;
};

const selectedTone = {
  brand:
    'data-[state=checked]:bg-surface data-[state=checked]:text-ink data-[state=checked]:shadow-raised',
  up: 'data-[state=checked]:bg-up data-[state=checked]:text-surface',
  down: 'data-[state=checked]:bg-down data-[state=checked]:text-surface',
} as const;

/**
 * Buy/Sell, Market/Limit, Delivery/Intraday. A radiogroup of radios (Radix RadioGroup), so arrow
 * keys move and select, and screen readers announce "radio, 1 of 2, checked".
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onValueChange,
  label,
  size = 'md',
  disabled,
  className,
}: SegmentedControlProps<T>) {
  return (
    <RadioGroup.Root
      aria-label={label}
      value={value}
      onValueChange={(next) => {
        const option = options.find((o) => o.value === next);
        if (option) onValueChange(option.value);
      }}
      orientation="horizontal"
      loop
      {...(disabled ? { disabled } : {})}
      className={cn(
        'inline-grid auto-cols-fr grid-flow-col gap-0.5 rounded-md border border-line bg-canvas p-0.5',
        className,
      )}
    >
      {options.map((option) => (
        <RadioGroup.Item
          key={option.value}
          value={option.value}
          className={cn(
            'rounded-[6px] font-medium text-ink-muted transition-colors duration-(--nth-duration-flash) hover:text-ink disabled:opacity-50',
            size === 'sm' ? 'h-7 px-3 text-label' : 'h-8 px-4 text-body',
            selectedTone[option.tone ?? 'brand'],
          )}
        >
          {option.label}
        </RadioGroup.Item>
      ))}
    </RadioGroup.Root>
  );
}
