import type { ApiClient } from '@nthstock/apiClient';
import { fixedClock, formatInr, fromIst } from '@nthstock/utils';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createMockServer } from '@/mocks/node';
import { initialSearchFocusState, useSearchFocusStore } from '@/shared/lib/searchFocusStore';
import { createTestQuoteStore, testQuote } from '@/test/quotes';
import { renderWithProviders } from '@/test/renderWithProviders';
import { resetSession } from '@/test/session';
import { findStock, loginOnMock } from '@/test/watchlists';
import { PortfolioPage, type PortfolioSearch } from './PortfolioPage';

/** Monday 28 Sep 2026, 10:00 IST, and the next morning: delivery buys are holdings by then. */
const MONDAY_MS = fromIst(2026, 9, 28, 10 * 60).getTime();
const TUESDAY_MS = fromIst(2026, 9, 29, 10 * 60).getTime();
// Each case logs in and makes several round trips on the MSW node server; CI runners are slow.
const HEAVY = 30_000;

let now = MONDAY_MS;
const mock = createMockServer({
  clock: fixedClock(MONDAY_MS),
  tickIntervalMs: 1_000_000_000,
  auth: { now: () => now },
});

let mobileSeq = 0;
const nextMobile = () => `98166${String(10_000 + (mobileSeq += 1)).slice(-5)}`;

type Bought = { symbol: string; qty: number; price: number; token: number };

/** Buys delivery shares on Monday at the mock LTP (on the tick) and moves to Tuesday morning. */
async function holdingsOf(lots: readonly [symbol: string, qty: number][]) {
  now = MONDAY_MS;
  const api = await loginOnMock(nextMobile(), 'http://portfolio.test');
  const bought: Bought[] = [];
  for (const [symbol, qty] of lots) {
    const { token } = await findStock(api, symbol);
    const quote = await mock.adapter.getQuote(symbol);
    const price = Math.round((quote?.ltp ?? 100_000) / 5) * 5;
    mock.orders.pinPrice(token, price);
    await api.request('orderPlace', {
      body: { token, side: 'BUY', type: 'MARKET', product: 'DELIVERY', qty },
    });
    bought.push({ symbol, qty, price, token });
  }
  now = TUESDAY_MS;
  return { api, bought };
}

function Harness({ initial = {} }: { initial?: PortfolioSearch }) {
  const [search, setSearch] = useState<PortfolioSearch>(initial);
  return (
    <PortfolioPage search={search} onSearchChange={(patch) => setSearch({ ...search, ...patch })} />
  );
}

function renderPortfolio(api: ApiClient, initial: PortfolioSearch = {}) {
  const quotes = createTestQuoteStore();
  const view = renderWithProviders(<Harness initial={initial} />, {
    apiClient: api,
    quoteStore: quotes.store,
  });
  return { ...view, quotes };
}

/** "₹1,23,456.78" or "▲ +₹1,234.50" → paise. */
const paiseOf = (text: string) => {
  const match = /(-?)(?:\+)?₹([\d,]+)\.(\d{2})/.exec(text);
  if (!match) throw new Error(`no amount in "${text}"`);
  const [, sign, rupees = '0', paise = '0'] = match;
  return (sign === '-' ? -1 : 1) * (Number(rupees.replaceAll(',', '')) * 100 + Number(paise));
};

const bodyRows = () =>
  within(screen.getByRole('table', { name: 'Holdings' }))
    .getAllByRole('row')
    .slice(1);
const cell = (rowElement: HTMLElement, column: string) =>
  rowElement.querySelector<HTMLElement>(`[data-column="${column}"]`)?.textContent ?? '';
const symbols = () => bodyRows().map((r) => r.getAttribute('data-symbol'));

/** The summary's figure for `label`, in paise. */
function summaryFigure(label: string): number {
  const summary = screen.getByRole('region', { name: 'Portfolio summary' });
  const term = within(summary).getByText(label);
  return paiseOf(term.nextElementSibling?.textContent ?? '');
}

function expectSummaryEqualsRows() {
  const rows = bodyRows();
  const current = rows.reduce((sum, r) => sum + paiseOf(cell(r, 'currentValue')), 0);
  const pnl = rows.reduce((sum, r) => sum + paiseOf(cell(r, 'pnl')), 0);
  expect(summaryFigure('Current value')).toBe(current);
  expect(summaryFigure('Total P&L')).toBe(pnl);
  expect(summaryFigure('Invested')).toBe(current - pnl);
}

beforeAll(() => {
  mock.server.listen({ onUnhandledRequest: 'error' });
});
afterEach(() => {
  resetSession();
  useSearchFocusStore.setState(initialSearchFocusState);
});
afterAll(() => {
  mock.server.close();
  mock.orders.dispose();
  mock.adapter.dispose();
});

describe('holdings table and live summary (T-151, T-152)', () => {
  it(
    'current value is qty × LTP in paise, and the summary equals the sum of the rows after each tick',
    async () => {
      const { api, bought } = await holdingsOf([
        ['INFY', 10],
        ['TCS', 3],
      ]);
      const { quotes } = renderPortfolio(api);
      await screen.findByRole('table', { name: 'Holdings' });
      expect(symbols()).toEqual(['INFY', 'TCS']);
      const [infy, tcs] = bought as [Bought, Bought];
      expect(cell(bodyRows()[0] as HTMLElement, 'currentValue')).toBe(
        formatInr(infy.qty * infy.price),
      );
      expectSummaryEqualsRows();

      for (const [infyLtp, tcsLtp] of [
        [infy.price + 12_35, tcs.price],
        [infy.price + 12_35, tcs.price - 40_05],
        [infy.price - 3_00, tcs.price + 1_00],
      ] as const) {
        act(() => {
          quotes.push(
            testQuote('INFY', infyLtp, { prevClose: infy.price }),
            testQuote('TCS', tcsLtp, { prevClose: tcs.price }),
          );
        });
        const [infyRow, tcsRow] = bodyRows() as [HTMLElement, HTMLElement];
        expect(cell(infyRow, 'currentValue')).toBe(formatInr(infy.qty * infyLtp));
        expect(cell(tcsRow, 'currentValue')).toBe(formatInr(tcs.qty * tcsLtp));
        expectSummaryEqualsRows();
        expect(summaryFigure('Day’s P&L')).toBe(
          infy.qty * (infyLtp - infy.price) + tcs.qty * (tcsLtp - tcs.price),
        );
      }
    },
    HEAVY,
  );

  it(
    'sorts by P&L high to low, then low to high, and says so with aria-sort',
    async () => {
      const { api, bought } = await holdingsOf([
        ['INFY', 10],
        ['TCS', 3],
        ['RELIANCE', 4],
      ]);
      const { quotes } = renderPortfolio(api);
      await screen.findByRole('table', { name: 'Holdings' });
      const [infy, tcs, reliance] = bought as [Bought, Bought, Bought];
      act(() => {
        quotes.push(
          testQuote('INFY', infy.price - 5_00, { prevClose: infy.price }), // −₹50.00
          testQuote('TCS', tcs.price + 30_00, { prevClose: tcs.price }), // +₹90.00
          testQuote('RELIANCE', reliance.price + 5_00, { prevClose: reliance.price }), // +₹20.00
        );
      });
      expect(symbols()).toEqual(['INFY', 'RELIANCE', 'TCS']);

      const header = screen.getByRole('button', { name: 'Sort by P&L' }).closest('th');
      fireEvent.click(screen.getByRole('button', { name: 'Sort by P&L' }));
      expect(symbols()).toEqual(['TCS', 'RELIANCE', 'INFY']);
      expect(header).toHaveAttribute('aria-sort', 'descending');
      fireEvent.click(screen.getByRole('button', { name: 'Sort by P&L' }));
      expect(symbols()).toEqual(['INFY', 'RELIANCE', 'TCS']);
      expect(header).toHaveAttribute('aria-sort', 'ascending');

      // The order follows the live values.
      act(() => {
        quotes.push(testQuote('INFY', infy.price + 20_00, { prevClose: infy.price })); // +₹200.00
      });
      expect(symbols()).toEqual(['RELIANCE', 'TCS', 'INFY']);
      const stockHeader = screen.getByRole('button', { name: 'Sort by Stock' }).closest('th');
      expect(stockHeader).toHaveAttribute('aria-sort', 'none');
    },
    HEAVY,
  );
});

describe('portfolio empty and error states (T-153)', () => {
  it(
    'with no holdings, shows the empty state whose button opens search',
    async () => {
      const { api } = await holdingsOf([]);
      renderPortfolio(api);
      expect(await screen.findByText('Your portfolio is empty')).toBeInTheDocument();
      expect(screen.queryByRole('region', { name: 'Portfolio summary' })).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'Search stocks' }));
      expect(useSearchFocusStore.getState().requests).toBe(1);
    },
    HEAVY,
  );

  it('shows an error with Retry when holdings cannot load', async () => {
    renderWithProviders(<Harness />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Your holdings could not load');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
  });
});
