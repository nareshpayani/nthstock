import { DropdownMenu as MenuPrimitive } from 'radix-ui';
import type { ComponentProps } from 'react';
import { IconCheck } from '../icons/icons.js';
import { cn } from '../lib/cn.js';

export const DropdownMenu = MenuPrimitive.Root;
export const DropdownMenuTrigger = MenuPrimitive.Trigger;
export const DropdownMenuGroup = MenuPrimitive.Group;
export const DropdownMenuRadioGroup = MenuPrimitive.RadioGroup;

export function DropdownMenuContent({
  className,
  sideOffset = 6,
  align = 'end',
  ...rest
}: ComponentProps<typeof MenuPrimitive.Content>) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Content
        sideOffset={sideOffset}
        align={align}
        className={cn(
          'z-(--nth-z-popover) min-w-48 rounded-md border border-line bg-surface p-1 shadow-overlay data-[state=open]:animate-pop-in',
          className,
        )}
        {...rest}
      />
    </MenuPrimitive.Portal>
  );
}

export function DropdownMenuItem({
  className,
  ...rest
}: ComponentProps<typeof MenuPrimitive.Item>) {
  return (
    <MenuPrimitive.Item
      className={cn(
        'flex cursor-pointer items-center gap-2 rounded-sm px-3 py-2 text-body text-ink outline-none select-none data-disabled:pointer-events-none data-disabled:opacity-50 data-highlighted:bg-canvas',
        className,
      )}
      {...rest}
    />
  );
}

export function DropdownMenuLabel({
  className,
  ...rest
}: ComponentProps<typeof MenuPrimitive.Label>) {
  return (
    <MenuPrimitive.Label
      className={cn('px-3 py-1.5 text-label text-ink-muted', className)}
      {...rest}
    />
  );
}

export function DropdownMenuSeparator({
  className,
  ...rest
}: ComponentProps<typeof MenuPrimitive.Separator>) {
  return <MenuPrimitive.Separator className={cn('my-1 h-px bg-line', className)} {...rest} />;
}

const checkableItemClass =
  'relative flex cursor-pointer items-center gap-2 rounded-sm py-2 pr-3 pl-9 text-body text-ink outline-none select-none data-disabled:pointer-events-none data-disabled:opacity-50 data-highlighted:bg-canvas';

function ItemCheck() {
  return (
    <span className="absolute left-3 flex size-4 items-center justify-center text-brand">
      <MenuPrimitive.ItemIndicator>
        <IconCheck size={16} />
      </MenuPrimitive.ItemIndicator>
    </span>
  );
}

/** One choice of a DropdownMenuRadioGroup (role menuitemradio): a tick marks the chosen one. */
export function DropdownMenuRadioItem({
  className,
  children,
  ...rest
}: ComponentProps<typeof MenuPrimitive.RadioItem>) {
  return (
    <MenuPrimitive.RadioItem className={cn(checkableItemClass, className)} {...rest}>
      <ItemCheck />
      {children}
    </MenuPrimitive.RadioItem>
  );
}

/** An on/off item (role menuitemcheckbox): a tick shows it is on. */
export function DropdownMenuCheckboxItem({
  className,
  children,
  ...rest
}: ComponentProps<typeof MenuPrimitive.CheckboxItem>) {
  return (
    <MenuPrimitive.CheckboxItem className={cn(checkableItemClass, className)} {...rest}>
      <ItemCheck />
      {children}
    </MenuPrimitive.CheckboxItem>
  );
}
