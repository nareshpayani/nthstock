import type { ApiClient } from '@nthstock/apiClient';
import type { PlaceOrderRequest } from '@nthstock/contracts';
import { fixedClock, formatInr, fromIst } from '@nthstock/utils';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { OrderTicketHost } from '@/features/orderTicket';
import { createMockServer } from '@/mocks/node';
import type { MarketSession } from '@/shared/lib/marketSessionContext';
import { initialSearchFocusState, useSearchFocusStore } from '@/shared/lib/searchFocusStore';
import { initialTicketIntentState, useTicketIntentStore } from '@/shared/lib/ticketIntentStore';
import { createTestQuoteStore, testQuote } from '@/test/quotes';
import { renderWithProviders } from '@/test/renderWithProviders';
import { installResizeObserver } from '@/test/resizeObserver';
import { resetSession } from '@/test/session';
import { findStock, loginOnMock } from '@/test/watchlists';
import { PositionsPage } from './PositionsPage';

/** Monday 28 Sep 2026, 10:00 IST: NSE is open. */
const OPEN_MS = fromIst(2026, 9, 28, 10 * 60).getTime();
// Each case logs in and makes several round trips on the MSW node server; CI runners are slow.
const HEAVY = 30_000;
const INFY_PRICE = 1_500_00;
const TCS_PRICE = 3_800_00;

const mock = createMockServer({
  clock: fixedClock(OPEN_MS),
  tickIntervalMs: 1_000_000_000,
  auth: { now: () => OPEN_MS },
});
const session: MarketSession = { clock: fixedClock(OPEN_MS), alwaysOpen: false };

let mobileSeq = 0;
const nextMobile = () => `98155${String(10_000 + (mobileSeq += 1)).slice(-5)}`;

type Tokens = { infy: number; tcs: number };

async function setup(): Promise<{ api: ApiClient; tokens: Tokens }> {
  const api = await loginOnMock(nextMobile(), 'http://positions.test');
  const tokens = {
    infy: (await findStock(api, 'INFY')).token,
    tcs: (await findStock(api, 'TCS')).token,
  };
  mock.orders.pinPrice(tokens.infy, INFY_PRICE);
  mock.orders.pinPrice(tokens.tcs, TCS_PRICE);
  return { api, tokens };
}

const place = (api: ApiClient, token: number, extra: Partial<PlaceOrderRequest>) =>
  api.request('orderPlace', {
    body: { token, side: 'BUY', type: 'MARKET', product: 'DELIVERY', qty: 1, ...extra },
  });

function renderPage(api: ApiClient) {
  const quotes = createTestQuoteStore();
  const view = renderWithProviders(
    <>
      <main id="main" tabIndex={-1}>
        <PositionsPage />
      </main>
      <OrderTicketHost />
    </>,
    { apiClient: api, quoteStore: quotes.store, marketSession: session },
  );
  return { ...view, quotes };
}

const table = () => screen.findByRole('table', { name: 'Positions' });
const row = (symbol: string) =>
  within(screen.getByRole('table', { name: 'Positions' }))
    .getAllByRole('row')
    .find((element) => element.textContent?.includes(symbol));

beforeAll(() => {
  mock.server.listen({ onUnhandledRequest: 'error' });
});
beforeEach(() => {
  installResizeObserver();
});
afterEach(() => {
  resetSession();
  useTicketIntentStore.setState(initialTicketIntentState);
  useSearchFocusStore.setState(initialSearchFocusState);
});
afterAll(() => {
  mock.server.close();
  mock.orders.dispose();
  mock.adapter.dispose();
});

describe('positions (T-149)', () => {
  it(
    'shows qty, average, live LTP and P&L per row, and a pinned live total P&L bar',
    async () => {
      const { api, tokens } = await setup();
      await place(api, tokens.infy, { qty: 10, product: 'INTRADAY' });
      await place(api, tokens.tcs, { qty: 2 });
      await place(api, tokens.tcs, { qty: 2, side: 'SELL' });
      const { quotes } = renderPage(api);
      await table();

      const infy = row('INFY');
      expect(infy).toHaveTextContent('Intraday');
      expect(infy).toHaveTextContent(formatInr(INFY_PRICE));
      expect(within(infy as HTMLElement).getByText('10')).toBeInTheDocument();
      // A bought-and-sold position is closed: no quantity to exit.
      const tcs = row('TCS');
      expect(tcs).toHaveTextContent('Closed');
      expect(within(tcs as HTMLElement).queryByRole('button', { name: /Exit/ })).toBeNull();
      const bar = screen.getByRole('region', { name: 'Total P&L' });
      expect(bar).toHaveTextContent('no profit or loss');

      // A tick moves the LTP and the P&L; the total follows, with ▲ and text as well as colour.
      act(() => {
        quotes.push(testQuote('INFY', INFY_PRICE + 2_50), testQuote('TCS', TCS_PRICE + 1_00));
      });
      expect(row('INFY')).toHaveTextContent(formatInr(INFY_PRICE + 2_50));
      expect(row('INFY')).toHaveTextContent('▲ +₹25.00');
      expect(row('INFY')).toHaveTextContent('profit ₹25.00');
      expect(within(bar).getAllByText('▲ +₹25.00')).toHaveLength(2); // total and unrealised

      act(() => {
        quotes.push(testQuote('INFY', INFY_PRICE - 1_00));
      });
      expect(row('INFY')).toHaveTextContent('▼ -₹10.00');
      expect(bar).toHaveTextContent('loss ₹10.00');
    },
    HEAVY,
  );

  it(
    'Exit on a long 10 INFY intraday position opens the ticket for SELL 10 INTRADAY (T-150)',
    async () => {
      const { api, tokens } = await setup();
      await place(api, tokens.infy, { qty: 10, product: 'INTRADAY' });
      renderPage(api);
      await table();
      const exit = screen.getByRole('button', { name: 'Exit INFY intraday position' });
      exit.focus();
      fireEvent.click(exit);

      const dialog = await screen.findByRole('dialog', { name: 'Trade INFY' });
      await within(dialog).findByRole('form', { name: 'Order details' });
      expect(within(dialog).getByRole('radio', { name: 'Sell' })).toHaveAttribute(
        'aria-checked',
        'true',
      );
      expect(within(dialog).getByRole('radio', { name: 'Intraday' })).toHaveAttribute(
        'aria-checked',
        'true',
      );
      expect(within(dialog).getByRole('textbox', { name: 'Quantity' })).toHaveValue('10');
      expect(useTicketIntentStore.getState().intent).toEqual({
        symbol: 'INFY',
        exchange: 'NSE',
        side: 'SELL',
        qty: 10,
        product: 'INTRADAY',
      });
    },
    HEAVY,
  );
});

describe('positions empty and error states (T-153)', () => {
  it(
    'with no positions, shows the empty state whose button opens search',
    async () => {
      const { api } = await setup();
      renderPage(api);
      expect(await screen.findByText('No positions today')).toBeInTheDocument();
      expect(screen.queryByRole('region', { name: 'Total P&L' })).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'Search stocks' }));
      expect(useSearchFocusStore.getState().requests).toBe(1);
    },
    HEAVY,
  );

  it('shows an error with Retry when positions cannot load', async () => {
    renderWithProviders(<PositionsPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Your positions could not load');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
  });
});
