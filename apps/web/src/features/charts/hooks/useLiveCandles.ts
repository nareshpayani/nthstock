import type { Candle, Exchange, Quote } from '@nthstock/contracts';
import { useState } from 'react';
import { useQuote } from '@/shared/hooks/useQuote';
import { applyTick, quoteToTick } from '../model/liveCandles';

type Track = { base: readonly Candle[]; bars: readonly Candle[]; quote: Quote | undefined };

/**
 * The 1D series kept live from the quote store (T-108): each committed quote (at most one per
 * animation frame) is folded into 1-minute bars with `applyTick`. When `candles` changes (a
 * refetch), the live bars start again from it. With `enabled` false it returns `candles` as is.
 */
export function useLiveCandles(
  symbol: string,
  exchange: Exchange,
  candles: readonly Candle[],
  enabled: boolean,
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
  if (enabled && quote && quote !== next.quote) {
    next = { ...next, bars: applyTick(next.bars, quoteToTick(quote, next.quote)), quote };
  }
  if (next !== track) setTrack(next);
  return enabled ? next.bars : candles;
}
