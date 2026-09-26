import { act, render, screen } from '@testing-library/react';
import { Profiler, type ProfilerOnRenderCallback } from 'react';
import { describe, expect, it } from 'vitest';
import { QuoteStoreContext } from '@/shared/lib/quoteStoreContext';
import { createTestQuoteStore, testQuote } from '@/test/quotes';
import { PriceCell } from './PriceCell';

function renderCells(symbols: readonly string[]) {
  const quotes = createTestQuoteStore();
  const renders = new Map<string, number>();
  const onRender: ProfilerOnRenderCallback = (id) => {
    renders.set(id, (renders.get(id) ?? 0) + 1);
  };
  const view = render(
    <QuoteStoreContext.Provider value={quotes.store}>
      {symbols.map((symbol) => (
        <Profiler key={symbol} id={symbol} onRender={onRender}>
          <div data-testid={symbol}>
            <PriceCell symbol={symbol} />
          </div>
        </Profiler>
      ))}
    </QuoteStoreContext.Provider>,
  );
  return { ...quotes, renders, view };
}

describe('PriceCell + quote store (T-056, T-057)', () => {
  it('100 ticks in one frame re-render the ticking cell once and no other cell', () => {
    const { push, ingest, frame, renders } = renderCells(['INFY', 'TCS', 'WIPRO']);
    act(() => {
      push(testQuote('INFY', 150000), testQuote('TCS', 400000), testQuote('WIPRO', 30000));
    });
    const before = new Map(renders);

    act(() => {
      for (let i = 1; i <= 100; i += 1) ingest(testQuote('INFY', 150000 + i * 5));
      frame();
    });
    expect(renders.get('INFY')).toBe((before.get('INFY') ?? 0) + 1);
    expect(renders.get('TCS')).toBe(before.get('TCS'));
    expect(renders.get('WIPRO')).toBe(before.get('WIPRO'));
    expect(screen.getByTestId('INFY')).toHaveTextContent('₹1,505.00▲');
  });

  it('shows a skeleton until the first quote, then the price with ▲ or ▼', () => {
    const { push } = renderCells(['INFY']);
    const cell = screen.getByTestId('INFY');
    expect(cell.querySelector('[data-skeleton]')).not.toBeNull();
    act(() => push(testQuote('INFY', 151235)));
    expect(cell).toHaveTextContent('₹1,512.35');
    expect(cell.querySelector('[data-tick]')).toHaveAttribute('data-tick', 'flat');
    act(() => push(testQuote('INFY', 151230)));
    expect(cell.querySelector('[data-tick]')).toHaveAttribute('data-tick', 'down');
    expect(cell.querySelector('[data-tick]')).toHaveClass('animate-flash-down-b');
  });

  it('subscribes on mount and releases on unmount, one source subscription per symbol', () => {
    const { subscribed, view } = renderCells(['INFY', 'INFY', 'TCS']);
    expect(subscribed.get('NSE:INFY')).toBe(1);
    expect(subscribed.get('NSE:TCS')).toBe(1);
    view.unmount();
    expect(subscribed.get('NSE:INFY')).toBe(0);
    expect(subscribed.get('NSE:TCS')).toBe(0);
  });

  it('renders index levels and other exchanges', () => {
    const quotes = createTestQuoteStore();
    render(
      <QuoteStoreContext.Provider value={quotes.store}>
        <PriceCell symbol="SENSEX" exchange="BSE" format="index" size="lg" />
      </QuoteStoreContext.Provider>,
    );
    expect(quotes.subscribed.get('BSE:SENSEX')).toBe(1);
    act(() => quotes.push(testQuote('SENSEX', 8309215, { exchange: 'BSE' })));
    expect(screen.getByText('83,092.15')).toBeInTheDocument();
  });
});
