import { Switch as SwitchPrimitive } from 'radix-ui';
import { useId } from 'react';
import { cn } from '../lib/cn.js';

export type SwitchProps = {
  checked?: boolean;
  defaultChecked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
  className?: string;
};

/** On/off toggle (role="switch") with a visible label. */
export function Switch({ label, className, ...rest }: SwitchProps) {
  const id = useId();
  return (
    <div className={cn('inline-flex items-center gap-2', className)}>
      <SwitchPrimitive.Root
        id={id}
        {...rest}
        className="relative inline-flex h-6 w-10 shrink-0 items-center rounded-pill bg-ink-muted transition-colors disabled:opacity-50 data-[state=checked]:bg-brand"
      >
        <SwitchPrimitive.Thumb className="block size-5 translate-x-0.5 rounded-pill bg-surface shadow-raised transition-transform data-[state=checked]:translate-x-[18px]" />
      </SwitchPrimitive.Root>
      <label htmlFor={id} className="text-body text-ink">
        {label}
      </label>
    </div>
  );
}
