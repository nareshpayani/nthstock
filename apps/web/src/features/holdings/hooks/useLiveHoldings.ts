import type { QuoteStore } from '@nthstock/apiClient';
import type { Holding } from '@nthstock/contracts';
import { useCallback, useState } from 'react';
import { useLiveSelection } from '@/shared/hooks/useLiveSelection';
import { useQuote } from '@/shared/hooks/useQuote';
import {
  createLiveHoldingsSelector,
  liveHolding,
  storeQuote,
  type LiveHoldings,
} from '../model/liveHoldings';

/**
 * Every holding at live prices and the live portfolio totals (T-148), for the portfolio summary:
 * the totals are the sums of the rows after each tick.
 */
export function useLiveHoldings(holdings: readonly Holding[]): LiveHoldings {
  const [select] = useState(createLiveHoldingsSelector);
  const read = useCallback(
    (store: QuoteStore) => select(holdings, storeQuote(store)),
    [select, holdings],
  );
  return useLiveSelection(holdings, read);
}

/** One holding at its live price: re-renders only on a tick in its own symbol. */
export function useLiveHolding(holding: Holding): Holding {
  const quote = useQuote(holding.symbol, holding.exchange)?.quote;
  return liveHolding(holding, quote);
}
