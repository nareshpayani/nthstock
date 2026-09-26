import type { Exchange } from '@nthstock/contracts';
import { ChangeBadge, Skeleton, cn, formatIndexLevel } from '@nthstock/ui';
import { formatInr } from '@nthstock/utils';
import { memo } from 'react';
import { useQuote } from '@/shared/hooks/useQuote';

export type LiveChangeProps = {
  symbol: string;
  exchange?: Exchange;
  /** `inr`: change in paise shown as ₹; `index`: change in hundredths shown as points. */
  format?: 'inr' | 'index';
  /** Change from a REST snapshot, shown until the first live quote arrives. */
  initial?: { change: number; changeBp: number } | undefined;
  /** Hide the absolute change and show only ▲▼ and the percent. */
  percentOnly?: boolean;
  soft?: boolean;
  size?: 'sm' | 'md';
  className?: string;
};

/** "+212.45" / "-₹12.30": the sign is always in the text, never only in the colour. */
export function formatSignedChange(change: number, format: 'inr' | 'index'): string {
  const sign = change > 0 ? '+' : change < 0 ? '-' : '';
  const magnitude = Math.abs(change);
  return `${sign}${format === 'index' ? formatIndexLevel(magnitude) : formatInr(magnitude)}`;
}

/**
 * Day change of one symbol, live from the quote store: ▲▼, signed text and colour (ChangeBadge).
 * Memoised and subscribed on its own, like PriceCell, so a tick re-renders only this badge.
 */
export const LiveChange = memo(function LiveChange({
  symbol,
  exchange = 'NSE',
  format = 'inr',
  initial,
  percentOnly = false,
  soft = false,
  size = 'sm',
  className,
}: LiveChangeProps) {
  const live = useQuote(symbol, exchange);
  const value = live ? { change: live.quote.change, changeBp: live.quote.changeBp } : initial;
  if (!value) return <Skeleton className={cn('inline-block h-4 w-24 align-middle', className)} />;
  return (
    <ChangeBadge
      basisPoints={value.changeBp}
      {...(percentOnly ? {} : { absolute: formatSignedChange(value.change, format) })}
      soft={soft}
      size={size}
      {...(className ? { className } : {})}
    />
  );
});
