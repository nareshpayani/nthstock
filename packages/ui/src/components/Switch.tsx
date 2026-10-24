import { Switch as SwitchPrimitive } from 'radix-ui';
import { useId } from 'react';
import { cn } from '../lib/cn.js';
import { useTouchTargets } from '../lib/touchTargets.js';

export type SwitchProps = {
  checked?: boolean;
  defaultChecked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
  className?: string;
};

/**
 * On/off toggle (role="switch") with a visible label. Inside `TouchTargets` the switch's tap area
 * grows to 44 × 44 px around the same track.
 */
export function Switch({ label, className, ...rest }: SwitchProps) {
  const id = useId();
  const touch = useTouchTargets();
  return (
    <div className={cn('inline-flex items-center gap-2', className)}>
      <SwitchPrimitive.Root
        id={id}
        {...rest}
        className={cn(
          'group inline-flex shrink-0 items-center justify-center rounded-pill disabled:opacity-50',
          touch && 'h-11 min-w-11',
        )}
      >
        <span className="relative inline-flex h-6 w-10 items-center rounded-pill bg-ink-muted transition-colors group-data-[state=checked]:bg-brand">
          <SwitchPrimitive.Thumb className="block size-5 translate-x-0.5 rounded-pill bg-surface shadow-raised transition-transform data-[state=checked]:translate-x-[18px]" />
        </span>
      </SwitchPrimitive.Root>
      <label htmlFor={id} className="text-body text-ink">
        {label}
      </label>
    </div>
  );
}
