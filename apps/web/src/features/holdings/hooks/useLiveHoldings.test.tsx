import type { Holding } from '@nthstock/contracts';
import { holdingValues } from '@nthstock/paperEngine';
import { act, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { QuoteStoreContext } from '@/shared/lib/quoteStoreContext';
import { createTestQuoteStore, testQuote } from '@/test/quotes';
import { useLiveHolding, useLiveHoldings } from './useLiveHoldings';

const holding = (symbol: string, qty: number, avg: number, ltp: number): Holding => ({
  token: 100 + symbol.length,
  symbol,
  exchange: 'NSE',
  ...holdingValues({ qty, investedValue: qty * avg }, ltp, ltp),
});

const holdings = [holding('INFY', 10, 1_500_00, 1_510_00), holding('TCS', 2, 3_700_00, 3_800_00)];

function Row({ item }: { item: Holding }) {
  const live = useLiveHolding(item);
  return <li data-testid={item.symbol}>{live.currentValue}</li>;
}

function Summary() {
  const { totals } = useLiveHoldings(holdings);
  return <p data-testid="current">{totals.currentValue}</p>;
}

describe('useLiveHoldings and useLiveHolding (T-148)', () => {
  it('revalue rows and totals on each tick; the totals are the sum of the rows', () => {
    const quotes = createTestQuoteStore();
    render(
      <QuoteStoreContext.Provider value={quotes.store}>
        <Summary />
        <ul>
          {holdings.map((item) => (
            <Row key={item.symbol} item={item} />
          ))}
        </ul>
      </QuoteStoreContext.Provider>,
    );
    expect(screen.getByTestId('current')).toHaveTextContent(String(10 * 1_510_00 + 2 * 3_800_00));
    act(() => {
      quotes.push(testQuote('INFY', 1_520_05, { prevClose: 1_510_00 }));
    });
    expect(screen.getByTestId('INFY')).toHaveTextContent(String(10 * 1_520_05));
    const sum = [...screen.getAllByRole('listitem')].reduce(
      (total, row) => total + Number(row.textContent),
      0,
    );
    expect(screen.getByTestId('current')).toHaveTextContent(String(sum));
  });
});
