import type { Candle, CandleInterval, Exchange, Quote } from '@nthstock/contracts';
import { useState } from 'react';
import { useQuote } from '@/shared/hooks/useQuote';
import { applyTick, quoteToTick } from '../model/liveCandles';

type Track = { base: readonly Candle[]; bars: readonly Candle[]; quote: Quote | undefined };

/**
 * A chart series kept live from the quote store (T-108; every range and bar size since
 * NSTOCK-0441): each committed quote (at most one per animation frame) is folded into the series'
 * `interval` bars with `applyTick`, so the last bar moves and a new one starts on time. When
 * `candles` changes (a refetch), the live bars start again from it. With `enabled` false it
 * returns `candles` as is.
 */
export function useLiveCandles(
  symbol: string,
  exchange: Exchange,
  candles: readonly Candle[],
  enabled: boolean,
  interval: CandleInterval = '1m',
): readonly Candle[] {
  const quote = useQuote(symbol, exchange)?.quote;
  const [track, setTrack] = useState<Track>(() => ({
    base: candles,
    bars: candles,
    quote: undefined,
  }));

  // Derived during render (React's "adjust state when a prop changes"), not in an effect, so the
  // chart never draws a frame behind the price cell.
  let next = track.base === candles ? track : { base: candles, bars: candles, quote: undefined };
  if (quote && quote !== next.quote) {
    // While disabled the quote is still remembered, so the first fold after the market opens adds
    // only the volume traded since, not the whole day's.
    next = enabled
      ? { ...next, bars: applyTick(next.bars, quoteToTick(quote, next.quote), interval), quote }
      : { ...next, quote };
  }
  if (next !== track) setTrack(next);
  return enabled ? next.bars : candles;
}
