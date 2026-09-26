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

export function TabsContent({ className, ...rest }: ComponentProps<typeof TabsPrimitive.Content>) {
  return <TabsPrimitive.Content className={cn('pt-4 outline-none', className)} {...rest} />;
}
