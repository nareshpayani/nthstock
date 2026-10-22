import type { MockMarketDataAdapter } from '@nthstock/marketData';
import type { SimulatorActions } from '@/shared/lib/demoSimulator';
import type { OrdersMock } from './handlers';

/** Rally and Pull back move the price by these ratios; Gap by `GAP_RATIO` (SPEC-TFC-1 T09). */
export const RALLY_RATIO = 0.01;
export const PULL_BACK_RATIO = -0.01;
export const GAP_RATIO = -0.03;
/** With split fills on, a LIMIT order fills at most this many shares per tick. */
export const SPLIT_FILL_QTY = 10;

/**
 * The demo Simulator over the mock market and the paper desk: it moves the real feed, so every
 * screen and every trailing stop sees the same price. Registered only in demo mode.
 */
export function createSimulator(deps: {
  adapter: MockMarketDataAdapter;
  orders: Pick<OrdersMock, 'setFillCap' | 'sweep'>;
}): SimulatorActions {
  const { adapter, orders } = deps;
  const split = new Set<string>();
  return {
    rally: (symbol) => Promise.resolve(adapter.nudge(symbol, RALLY_RATIO)),
    pullBack: (symbol) => Promise.resolve(adapter.nudge(symbol, PULL_BACK_RATIO)),
    gapDown: async (symbol) => {
      const quote = adapter.gap(symbol, GAP_RATIO);
      // The gap tick reaches the desk through the feed; sweeping makes sure no account lags it.
      if (quote) await orders.sweep();
      return quote !== null;
    },
    setSplitFills: async (symbol, on) => {
      const instrument = await adapter.getInstrument(symbol);
      if (!instrument) return;
      orders.setFillCap(instrument.token, on ? SPLIT_FILL_QTY : null);
      if (on) split.add(symbol);
      else split.delete(symbol);
    },
    splitFills: (symbol) => split.has(symbol),
  };
}
