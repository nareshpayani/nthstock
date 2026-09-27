import type { Holding } from '@nthstock/contracts';
import { holdingValues } from '@nthstock/paperEngine';
import { describe, expect, it } from 'vitest';
import { DEFAULT_HOLDINGS_SORT, nextHoldingsSort, sortHoldings } from './holdingsSort';

const holding = (symbol: string, qty: number, avg: number, ltp: number): Holding => ({
  token: 100 + symbol.length,
  symbol,
  exchange: 'NSE',
  ...holdingValues({ qty, investedValue: qty * avg }, ltp, ltp),
});

const rows = [
  holding('TCS', 2, 3_700_00, 3_800_00), // P&L +200.00
  holding('INFY', 10, 1_500_00, 1_480_00), // P&L -200.00
  holding('HDFCBANK', 5, 1_600_00, 1_640_00), // P&L +200.00
  holding('WIPRO', 20, 500_00, 510_00), // P&L +200.00 (qty 20)
];

describe('holdings sort (T-151)', () => {
  it('sorts by P&L both ways, ties A–Z by symbol', () => {
    expect(sortHoldings(rows, { key: 'pnl', dir: 'desc' }).map((r) => r.symbol)).toEqual([
      'HDFCBANK',
      'TCS',
      'WIPRO',
      'INFY',
    ]);
    expect(sortHoldings(rows, { key: 'pnl', dir: 'asc' }).map((r) => r.symbol)).toEqual([
      'INFY',
      'HDFCBANK',
      'TCS',
      'WIPRO',
    ]);
  });

  it('sorts by symbol and by current value, without touching the input', () => {
    const copy = [...rows];
    expect(sortHoldings(rows, DEFAULT_HOLDINGS_SORT).map((r) => r.symbol)).toEqual([
      'HDFCBANK',
      'INFY',
      'TCS',
      'WIPRO',
    ]);
    expect(sortHoldings(rows, { key: 'symbol', dir: 'desc' })[0]?.symbol).toBe('WIPRO');
    expect(sortHoldings(rows, { key: 'currentValue', dir: 'desc' })[0]?.symbol).toBe('INFY');
    expect(rows).toEqual(copy);
  });

  it('a header click flips the same column and starts a new number column high to low', () => {
    expect(nextHoldingsSort(DEFAULT_HOLDINGS_SORT, 'symbol')).toEqual({
      key: 'symbol',
      dir: 'desc',
    });
    expect(nextHoldingsSort(DEFAULT_HOLDINGS_SORT, 'pnl')).toEqual({ key: 'pnl', dir: 'desc' });
    expect(nextHoldingsSort({ key: 'pnl', dir: 'desc' }, 'pnl')).toEqual({
      key: 'pnl',
      dir: 'asc',
    });
    expect(nextHoldingsSort({ key: 'pnl', dir: 'asc' }, 'symbol')).toEqual({
      key: 'symbol',
      dir: 'asc',
    });
  });
});
