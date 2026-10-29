import type { CandleInterval, CandleRange, MoverDirection } from '@nthstock/contracts';
import type { PriceChartType } from '@/features/charts';

/** The dashboard's URL search params (validated in the route file). */
export type DashboardSearch = {
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
};
