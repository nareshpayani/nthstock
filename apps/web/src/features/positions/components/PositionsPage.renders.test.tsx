import { createApiClient } from '@nthstock/apiClient';
import type { Position, PositionsResponse } from '@nthstock/contracts';
import { act, screen } from '@testing-library/react';
import type * as Ui from '@nthstock/ui';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { createTestQuoteStore, testQuote } from '@/test/quotes';
import type * as PnlAmountModule from '@/shared/components/PnlAmount';
import { renderWithProviders } from '@/test/renderWithProviders';
import { PositionsPage } from './PositionsPage';

/**
 * Render counts for the P&L acceptance criterion (T-149): a tick recomputes P&L, and only the P&L
 * (and LTP) cells re-render, never the rows. Rows render through `TableRow` and every P&L through
 * `PnlAmount`, so both are wrapped with counters.
 */
const counts = vi.hoisted(() => ({ rows: 0, pnl: [] as number[] }));

vi.mock('@nthstock/ui', async (importOriginal) => {
  const ui = await importOriginal<typeof Ui>();
  return {
    ...ui,
    TableRow: (props: ComponentProps<typeof ui.TableRow>) => {
      counts.rows += 1;
      return <ui.TableRow {...props} />;
    },
  };
});

vi.mock('@/shared/components/PnlAmount', async (importOriginal) => {
  const real = await importOriginal<typeof PnlAmountModule>();
  return {
    ...real,
    PnlAmount: (props: ComponentProps<typeof real.PnlAmount>) => {
      counts.pnl.push(props.value);
      return <real.PnlAmount {...props} />;
    },
  };
});

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

const body: PositionsResponse = {
  items: [
    position('INFY', 'DELIVERY', 1_500_00),
    position('INFY', 'INTRADAY', 1_500_00),
    position('TCS', 'INTRADAY', 3_800_00),
  ],
};

/** Answers `GET /v1/positions` with `body`; nothing else is called. */
const apiClient = createApiClient({
  baseUrl: 'http://positions.test',
  fetch: () => Promise.resolve(Response.json(body)),
});

describe('positions render counts (T-149)', () => {
  it('a tick recomputes P&L and re-renders only the P&L cells of that symbol, not the rows', async () => {
    const quotes = createTestQuoteStore();
    renderWithProviders(<PositionsPage />, { apiClient, quoteStore: quotes.store });
    await screen.findByRole('table', { name: 'Positions' });
    act(() => {
      quotes.push(testQuote('INFY', 1_500_00), testQuote('TCS', 3_800_00));
    });

    counts.rows = 0;
    counts.pnl.length = 0;
    act(() => {
      quotes.push(testQuote('TCS', 3_810_00));
    });
    expect(counts.rows).toBe(0);
    // The TCS cell (+₹100.00), then the bar's total, realised and unrealised: nothing for INFY.
    expect(counts.pnl).toEqual([100_00, 100_00, 0, 100_00]);

    counts.pnl.length = 0;
    act(() => {
      quotes.push(testQuote('INFY', 1_499_00));
    });
    expect(counts.rows).toBe(0);
    // Both INFY cells (−₹10.00 each), then the bar: +₹100.00 − ₹20.00.
    expect(counts.pnl).toEqual([-10_00, -10_00, 80_00, 0, 80_00]);
    expect(screen.getByRole('region', { name: 'Total P&L' })).toHaveTextContent('▲ +₹80.00');
  });
});
