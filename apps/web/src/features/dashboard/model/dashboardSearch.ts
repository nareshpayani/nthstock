import type { CandleInterval, CandleRange, MoverDirection } from '@nthstock/contracts';
import type { PriceChartType } from '@/features/charts';

/**
 * What the dashboard's first chart can show (NSTOCK-0476): stocks you can trade on the chart, then
 * the NIFTY 50 index. HDFCBANK when the URL names none.
 */
export const HOME_CHART_SYMBOLS = ['HDFCBANK', 'PAYTM', 'RELIANCE', 'NIFTY50'] as const;
export type HomeChartSymbol = (typeof HOME_CHART_SYMBOLS)[number];
export const DEFAULT_HOME_CHART_SYMBOL: HomeChartSymbol = 'HDFCBANK';

/** The dashboard's URL search params (validated in the route file). */
export type DashboardSearch = {
  /** The first chart's instrument; HDFCBANK when absent. */
  stock?: HomeChartSymbol | undefined;
  range?: CandleRange | undefined;
  /** NIFTY 50 bar size (NSTOCK-0443); the range's own when absent or not offered. */
  interval?: CandleInterval | undefined;
  /** NIFTY 50 chart type; a line when absent. */
  chart?: PriceChartType | undefined;
  /** Curated list id, e.g. `best-returns`. */
  list?: string | undefined;
  movers?: MoverDirection | undefined;
  /** Index whose movers are shown, e.g. `NIFTYBANK`. */
  moversIndex?: string | undefined;
  /** The phone Home's list tab (NSTOCK-0466); Watchlist when absent. */
  feed?: 'watchlist' | 'gainers' | 'losers' | undefined;
};
