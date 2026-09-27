import { PAPER_OPENING_BALANCE_PAISE, type Position } from '@nthstock/contracts';
import { describe, expect, it } from 'vitest';
import { livePosition } from '@/features/positions';
import { fundsTotals } from './fundsTotals';

const opening = {
  openingBalance: PAPER_OPENING_BALANCE_PAISE,
  balance: PAPER_OPENING_BALANCE_PAISE,
  blocked: 0,
  available: PAPER_OPENING_BALANCE_PAISE,
};
const noHoldings = { investedValue: 0, currentValue: 0 };

const position = (netQty: number, price: number, ltp: number): Position => ({
  token: 408065,
  symbol: 'INFY',
  exchange: 'NSE',
  product: 'INTRADAY',
  netQty,
  buyQty: Math.max(netQty, 0),
  sellQty: Math.max(-netQty, 0),
  avgBuyPrice: netQty > 0 ? price : 0,
  avgSellPrice: netQty < 0 ? price : 0,
  ltp,
  realisedPnl: 0,
  unrealisedPnl: netQty * (ltp - price),
});

describe('fundsTotals (T-158)', () => {
  it('opens at ₹10,00,000 with nothing invested', () => {
    expect(fundsTotals(opening, [], noHoldings)).toEqual({
      openingBalance: PAPER_OPENING_BALANCE_PAISE,
      available: PAPER_OPENING_BALANCE_PAISE,
      blocked: 0,
      invested: 0,
      marketValue: 0,
      total: PAPER_OPENING_BALANCE_PAISE,
    });
  });

  it('a ₹15,000 buy moves cash into invested; the total holds until the price moves', () => {
    const cash = { ...opening, balance: opening.balance - 15_000_00 };
    const after = { ...cash, available: cash.balance };
    const bought = position(10, 1_500_00, 1_500_00);
    const totals = fundsTotals(after, [livePosition(bought, undefined)], noHoldings);
    expect(opening.available - totals.available).toBe(15_000_00);
    expect(totals).toMatchObject({ invested: 15_000_00, total: PAPER_OPENING_BALANCE_PAISE });
    const moved = fundsTotals(after, [livePosition(bought, 1_510_00)], noHoldings);
    expect(moved.total).toBe(PAPER_OPENING_BALANCE_PAISE + 10 * 10_00);
    expect(moved.invested).toBe(15_000_00);
  });

  it('counts holdings, blocked cash, and a short against the total', () => {
    const funds = {
      ...opening,
      balance: opening.balance + 3 * 1_500_00,
      blocked: 1_000_00,
      available: opening.balance + 3 * 1_500_00 - 1_000_00,
    };
    const short = livePosition(position(-3, 1_500_00, 1_500_00), 1_520_00);
    const totals = fundsTotals(funds, [short], {
      investedValue: 50_000_00,
      currentValue: 52_000_00,
    });
    expect(totals.invested).toBe(50_000_00);
    expect(totals.marketValue).toBe(52_000_00 - 3 * 1_520_00);
    expect(totals.total).toBe(funds.balance + 52_000_00 - 3 * 1_520_00);
    expect(totals.blocked).toBe(1_000_00);
  });
});
