import type { CandleRange } from '@nthstock/contracts';

/** The dashboard's URL search params (validated in the route file). */
export type DashboardSearch = {
  range?: CandleRange | undefined;
  /** Curated list id, e.g. `best-returns`. */
  list?: string | undefined;
};
