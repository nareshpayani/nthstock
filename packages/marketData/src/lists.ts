import type { MoverDirection, QuoteRow, StockList } from '@nthstock/contracts';
import type { MasterEquity } from './symbolMaster.js';

export const LIST_SIZE = 15;
export const MOVERS_LIMIT_DEFAULT = 10;

/** A master equity with its live row and current market cap in paise. */
export type LiveEquity = { equity: MasterEquity; row: QuoteRow; marketCap: number };

type ListDef = {
  id: string;
  title: string;
  description: string;
  select: (equities: readonly LiveEquity[]) => LiveEquity[];
};

const bySymbol = (a: LiveEquity, b: LiveEquity) => a.row.symbol.localeCompare(b.row.symbol);
const byMarketCap = (a: LiveEquity, b: LiveEquity) => b.marketCap - a.marketCap || bySymbol(a, b);
const established = (e: LiveEquity) => e.equity.capBucket !== 'SMALL';

/** The dashboard's curated lists, derived from the master and live quotes. */
export const STOCK_LIST_DEFS: readonly ListDef[] = [
  {
    id: 'market-giants',
    title: 'Market Giants',
    description: 'The largest companies by market capitalisation',
    select: (all) => [...all].sort(byMarketCap),
  },
  {
    id: 'best-returns',
    title: 'Best Returns',
    description: 'Large and mid caps with the highest one-year returns',
    select: (all) =>
      all
        .filter(established)
        .sort((a, b) => b.equity.return1yBp - a.equity.return1yBp || bySymbol(a, b)),
  },
  {
    id: 'highest-dividends',
    title: 'Highest Dividends',
    description: 'Large and mid caps with the highest dividend yield',
    select: (all) =>
      all
        .filter(established)
        .sort((a, b) => b.equity.dividendYieldBp - a.equity.dividendYieldBp || bySymbol(a, b)),
  },
  {
    id: 'top-it',
    title: 'Top IT',
    description: 'Leading information technology companies',
    select: (all) =>
      all.filter((e) => e.equity.sector === 'Information Technology').sort(byMarketCap),
  },
];

export function buildStockList(def: ListDef, equities: readonly LiveEquity[]): StockList {
  return {
    id: def.id,
    title: def.title,
    description: def.description,
    items: def
      .select(equities)
      .slice(0, LIST_SIZE)
      .map((e) => e.row),
  };
}

/**
 * Gainers: rows with a positive change, highest % change first. Losers: negative change, lowest
 * first. Ties break by symbol so the order is stable.
 */
export function rankMovers(
  rows: readonly QuoteRow[],
  direction: MoverDirection,
  limit: number = MOVERS_LIMIT_DEFAULT,
): QuoteRow[] {
  const sign = direction === 'gainers' ? 1 : -1;
  return rows
    .filter((r) => sign * r.changeBp > 0)
    .sort((a, b) => sign * (b.changeBp - a.changeBp) || a.symbol.localeCompare(b.symbol))
    .slice(0, Math.max(0, Math.floor(limit)));
}
