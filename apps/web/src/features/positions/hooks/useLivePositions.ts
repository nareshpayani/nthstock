import type { Position } from '@nthstock/contracts';
import { useCallback, useState } from 'react';
import { useLiveSelection } from '@/shared/hooks/useLiveSelection';
import { useQuote } from '@/shared/hooks/useQuote';
import {
  createLivePositionsSelector,
  livePosition,
  storeLtp,
  type LivePosition,
  type LivePositions,
} from '../model/livePnl';

/**
 * Every position with live P&L and the live totals (T-148), for the pinned total P&L bar. It
 * re-renders on a tick in any of the positions' symbols; rows use `useLivePosition` instead.
 */
export function useLivePositions(positions: readonly Position[]): LivePositions {
  const [select] = useState(createLivePositionsSelector);
  const read = useCallback(
    (store: Parameters<typeof storeLtp>[0]) => select(positions, storeLtp(store)),
    [select, positions],
  );
  return useLiveSelection(positions, read);
}

/** One position with live P&L: re-renders only on a tick in its own symbol. */
export function useLivePosition(position: Position): LivePosition {
  const ltp = useQuote(position.symbol, position.exchange)?.quote.ltp;
  return livePosition(position, ltp);
}
