import { act, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { QuoteStoreContext } from '@/shared/lib/quoteStoreContext';
import { createTestQuoteStore, testQuote } from '@/test/quotes';
import { LiveChange, formatSignedChange } from './LiveChange';

describe('LiveChange', () => {
  it('signs the change in text for rupees and index points', () => {
    expect(formatSignedChange(1230, 'inr')).toBe('+₹12.30');
    expect(formatSignedChange(-1230, 'inr')).toBe('-₹12.30');
    expect(formatSignedChange(0, 'inr')).toBe('₹0.00');
    expect(formatSignedChange(-21245, 'index')).toBe('-212.45');
  });

  it('shows the snapshot change, then follows live quotes with ▲▼ and signed text', () => {
    const quotes = createTestQuoteStore();
    render(
      <QuoteStoreContext.Provider value={quotes.store}>
        <div data-testid="cell">
          <LiveChange symbol="INFY" initial={{ change: 1230, changeBp: 82 }} />
        </div>
      </QuoteStoreContext.Provider>,
    );
    const cell = screen.getByTestId('cell');
    expect(cell).toHaveTextContent('+₹12.30 (▲ 0.82%)');
    expect(quotes.subscribed.get('NSE:INFY')).toBe(1);
    act(() => quotes.push(testQuote('INFY', 148770, { prevClose: 150000 })));
    expect(cell).toHaveTextContent('-₹12.30 (▼ 0.82%)');
    expect(screen.getByText('-₹12.30, down 0.82 percent')).toBeInTheDocument();
  });

  it('shows a skeleton with no snapshot and no quote, and can show the percent only', () => {
    const quotes = createTestQuoteStore();
    const view = render(
      <QuoteStoreContext.Provider value={quotes.store}>
        <div data-testid="cell">
          <LiveChange symbol="NIFTY50" format="index" percentOnly />
        </div>
      </QuoteStoreContext.Provider>,
    );
    expect(view.container.querySelector('[data-skeleton]')).not.toBeNull();
    act(() => quotes.push(testQuote('NIFTY50', 2541860, { prevClose: 2520615 })));
    expect(screen.getByTestId('cell')).toHaveTextContent(/^▲ 0.84%up 0.84 percent$/);
  });
});
