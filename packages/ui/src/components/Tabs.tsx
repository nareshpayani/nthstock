import { Tabs as TabsPrimitive } from 'radix-ui';
import type { ComponentProps } from 'react';
import { cn } from '../lib/cn.js';

export const Tabs = TabsPrimitive.Root;

export function TabsList({ className, ...rest }: ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      className={cn('flex gap-4 overflow-x-auto border-b border-line', className)}
      {...rest}
    />
  );
}

export function TabsTrigger({ className, ...rest }: ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        '-mb-px shrink-0 border-b-2 border-transparent px-1 py-2 text-body font-medium whitespace-nowrap text-ink-muted hover:text-ink data-[state=active]:border-brand data-[state=active]:text-brand',
        className,
      )}
      {...rest}
    />
  );
}

/** Radix makes the panel a Tab stop, so keyboard focus on it draws a ring (WCAG 2.4.7). */
const tabsContentClass =
  'rounded-sm pt-4 outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2';

export function TabsContent({ className, ...rest }: ComponentProps<typeof TabsPrimitive.Content>) {
  return <TabsPrimitive.Content className={cn(tabsContentClass, className)} {...rest} />;
}
