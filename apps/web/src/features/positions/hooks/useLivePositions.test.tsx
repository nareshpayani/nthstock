import type { Position } from '@nthstock/contracts';
import { act, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { QuoteStoreContext } from '@/shared/lib/quoteStoreContext';
import { createTestQuoteStore, testQuote } from '@/test/quotes';
import { useLivePosition, useLivePositions } from './useLivePositions';

const position = (symbol: string, product: Position['product'], ltp: number): Position => ({
  token: 100 + symbol.length,
  symbol,
  exchange: 'NSE',
  product,
  netQty: 10,
  buyQty: 10,
  sellQty: 0,
  avgBuyPrice: ltp,
  avgSellPrice: 0,
  ltp,
  realisedPnl: 0,
  unrealisedPnl: 0,
});

const positions = [
  position('INFY', 'DELIVERY', 1_500_00),
  position('INFY', 'INTRADAY', 1_500_00),
  position('TCS', 'DELIVERY', 3_800_00),
];

const renders = new Map<string, number>();

function Row({ item }: { item: Position }) {
  const live = useLivePosition(item);
  renders.set(live.key, (renders.get(live.key) ?? 0) + 1);
  return <li data-testid={live.key}>{live.pnl}</li>;
}

function Total() {
  const { totals } = useLivePositions(positions);
  return <p data-testid="total">{totals.pnl}</p>;
}

describe('useLivePosition and useLivePositions (T-148)', () => {
  it('a tick re-renders only the rows of that symbol, and the total follows', () => {
    const quotes = createTestQuoteStore();
    render(
      <QuoteStoreContext.Provider value={quotes.store}>
        <Total />
        <ul>
          {positions.map((item) => (
            <Row key={`${item.symbol}:${item.product}`} item={item} />
          ))}
        </ul>
      </QuoteStoreContext.Provider>,
    );
    expect(quotes.subscribed.get('NSE:INFY')).toBeGreaterThan(0);
    expect(quotes.subscribed.get('NSE:TCS')).toBeGreaterThan(0);
    renders.clear();

    act(() => {
      quotes.push(testQuote('TCS', 3_810_00));
    });
    expect(screen.getByTestId('NSE:TCS:DELIVERY')).toHaveTextContent(String(10 * 10_00));
    expect(screen.getByTestId('NSE:INFY:DELIVERY')).toHaveTextContent('0');
    expect([...renders.keys()]).toEqual(['NSE:TCS:DELIVERY']);
    expect(screen.getByTestId('total')).toHaveTextContent(String(10 * 10_00));

    renders.clear();
    act(() => {
      quotes.push(testQuote('INFY', 1_499_00));
    });
    expect([...renders.keys()].sort()).toEqual(['NSE:INFY:DELIVERY', 'NSE:INFY:INTRADAY']);
    expect(screen.getByTestId('total')).toHaveTextContent(String(10 * 10_00 - 2 * 10 * 1_00));
  });
});
