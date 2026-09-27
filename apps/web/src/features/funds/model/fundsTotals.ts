import type { FundsSummary } from '@nthstock/contracts';
import type { LiveHoldingsTotals } from '@/features/holdings';
import { positionBook, type LivePosition } from '@/features/positions';

/** The funds summary's figures (T-158), all integer paise. */
export type FundsTotals = {
  openingBalance: number;
  /** Cash free to trade with. */
  available: number;
  /** Cash held against open BUY orders. */
  blocked: number;
  /** What the open holdings and long positions cost. */
  invested: number;
  /** Holdings and positions at live prices; a short counts against it (it must be bought back). */
  marketValue: number;
  /** Cash (available plus blocked) plus `marketValue`. */
  total: number;
};

/**
 * The funds summary (T-158) from the paper cash and the live holdings and positions. Buying at
 * the LTP moves cash into `marketValue` one for one, so `total` is unchanged until prices move:
 * a ₹15,000 buy takes ₹15,000.00 off `available` and adds it to `invested` and `marketValue`.
 */
export function fundsTotals(
  funds: Pick<FundsSummary, 'openingBalance' | 'balance' | 'blocked' | 'available'>,
  positions: readonly LivePosition[],
  holdings: Pick<LiveHoldingsTotals, 'investedValue' | 'currentValue'>,
): FundsTotals {
  let invested = holdings.investedValue;
  let marketValue = holdings.currentValue;
  for (const row of positions) {
    const { netQty } = row.position;
    if (netQty > 0) invested += positionBook(row.position).openCost;
    marketValue += netQty * row.ltp;
  }
  return {
    openingBalance: funds.openingBalance,
    available: funds.available,
    blocked: funds.blocked,
    invested,
    marketValue,
    total: funds.balance + marketValue,
  };
}
