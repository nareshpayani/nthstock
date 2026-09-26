import { systemClock, type Clock } from '@nthstock/utils';
import { createContext } from 'react';

export type MarketSession = {
  /** The source of "now" for NSE hours and holidays. Tests inject a fixed clock. */
  clock: Clock;
  /** msw mode with VITE_MOCK_MARKET_OPEN: the mock market ticks at any hour, so treat it as open. */
  alwaysOpen: boolean;
};

export const MarketSessionContext = createContext<MarketSession>({
  clock: systemClock,
  alwaysOpen: false,
});
