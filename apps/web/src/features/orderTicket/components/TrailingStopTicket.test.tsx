import { createTradingStore, type ApiClient, type TradingStore } from '@nthstock/apiClient';
import type { OrderSide, ProductType } from '@nthstock/contracts';
import { fixedClock, fromIst } from '@nthstock/utils';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createMockServer } from '@/mocks/node';
import { useOpenTicket } from '@/shared/hooks/useOpenTicket';
import type { MarketSession } from '@/shared/lib/marketSessionContext';
import { initialTicketIntentState, useTicketIntentStore } from '@/shared/lib/ticketIntentStore';
import { createTestQuoteStore } from '@/test/quotes';
import { renderWithProviders } from '@/test/renderWithProviders';
import { installResizeObserver } from '@/test/resizeObserver';
import { resetSession } from '@/test/session';
import { loginOnMock } from '@/test/watchlists';
import { OrderTicketHost } from './OrderTicketHost';

/** Monday 28 Sep 2026, 10:00 IST: NSE is open, so Delivery and Intraday both trade. */
const OPEN_MS = fromIst(2026, 9, 28, 10 * 60).getTime();
const HEAVY = 20_000;

function Harness() {
  const openTicket = useOpenTicket();
  const trade = (side: OrderSide) => void openTicket({ symbol: 'INFY', exchange: 'NSE', side });
  return (
    <>
      <main id="main" tabIndex={-1}>
        <button type="button" onClick={() => trade('SELL')}>
          Sell INFY
        </button>
      </main>
      <OrderTicketHost />
    </>
  );
}

let mobileSeq = 0;
const nextMobile = () => `98144${String(10_000 + (mobileSeq += 1)).slice(-5)}`;

const mock = createMockServer({
  clock: fixedClock(OPEN_MS),
  tickIntervalMs: 1_000_000_000,
  auth: { now: () => OPEN_MS },
});
const session: MarketSession = { clock: fixedClock(OPEN_MS), alwaysOpen: false };

async function buy(api: ApiClient, product: ProductType, qty: number) {
  const quote = await mock.adapter.getQuote('INFY');
  if (!quote) throw new Error('no INFY');
  await api.request('orderPlace', {
    body: { token: quote.token, side: 'BUY', type: 'MARKET', product, qty },
  });
}

/** Signs in, buys `positions`, then opens the ticket with the given trading store. */
async function renderWithPositions(
  positions: [ProductType, number][],
  store?: (api: ApiClient) => TradingStore,
) {
  const api = await loginOnMock(nextMobile(), 'http://trailing.test');
  for (const [product, qty] of positions) await buy(api, product, qty);
  const tradingStore = store?.(api);
  await tradingStore?.start();
  renderWithProviders(<Harness />, {
    apiClient: api,
    quoteStore: createTestQuoteStore().store,
    marketSession: session,
    ...(tradingStore ? { tradingStore } : {}),
  });
  fireEvent.click(await screen.findByRole('button', { name: 'Sell INFY' }));
  const dialog = await screen.findByRole('dialog', { name: 'Trade INFY' });
  await within(dialog).findByRole('form', { name: 'Order details' });
  return { dialog, api, tradingStore };
}

const liveStore = (api: ApiClient) =>
  createTradingStore({
    loadState: () => api.request('accountState'),
    schedule: (flush) => queueMicrotask(flush),
  });

const typeGroup = () => screen.getByRole('radiogroup', { name: 'Order type' });

beforeAll(() => mock.server.listen({ onUnhandledFrame: 'error' }));
beforeEach(() => {
  installResizeObserver();
});
afterEach(() => {
  resetSession();
  useTicketIntentStore.setState(initialTicketIntentState);
});
afterAll(() => {
  mock.server.close();
  mock.orders.dispose();
  mock.adapter.dispose();
});

describe('Trailing stop order type (T13, SPEC-TFC-1 §7)', () => {
  it(
    'is offered beside Market and Limit only when the user holds a position',
    async () => {
      await renderWithPositions([], liveStore);
      expect(
        within(typeGroup())
          .getAllByRole('radio')
          .map((r) => r.textContent),
      ).toEqual(['Market', 'Limit']);
    },
    HEAVY,
  );

  it(
    'states the fixed quantity, previews the stop, shows margin and charges, and places a stop the store holds',
    async () => {
      const { tradingStore } = await renderWithPositions([['DELIVERY', 10]], liveStore);
      fireEvent.click(await within(typeGroup()).findByRole('radio', { name: 'Trailing stop' }));
      expect(await screen.findByTestId('trailing-protects')).toHaveTextContent(
        'Exit for your long position: Sell 10 shares when the stop is hit.',
      );
      expect(screen.queryByRole('radiogroup', { name: 'Order side' })).not.toBeInTheDocument();
      expect(screen.getByTestId('trailing-margin')).toHaveTextContent('₹0.00');
      expect(screen.getByText(/Paper trades have no charges/)).toBeInTheDocument();

      const trail = screen.getByRole('textbox', { name: 'Trail (%)' });
      fireEvent.change(trail, { target: { value: '25' } });
      expect(await screen.findByText('Enter a trail between 0.10% and 20%.')).toBeInTheDocument();
      fireEvent.change(trail, { target: { value: '1.5' } });
      await waitFor(() =>
        expect(screen.getByTestId('trailing-preview')).toHaveTextContent(
          /^Initial stop ₹[\d,]+\.\d\d, trails 1\.5% below the high$/,
        ),
      );

      fireEvent.click(screen.getByRole('button', { name: 'Review trailing stop' }));
      expect(
        await screen.findByText(
          'Sell 10 INFY with a market order when the price falls from its high by 1.5%. The stop only ever tightens.',
        ),
      ).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Place trailing stop' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      await waitFor(() =>
        expect(tradingStore?.getState().trailingStops[0]).toMatchObject({
          status: 'TRAILING',
          protectedQty: 10,
          trail: { unit: 'PERCENT', basisPoints: 150 },
        }),
      );
      expect(tradingStore?.getState().pending).toEqual([]);
    },
    HEAVY,
  );

  it(
    'asks which position to protect when both Delivery and Intraday are open',
    async () => {
      await renderWithPositions(
        [
          ['DELIVERY', 10],
          ['INTRADAY', 4],
        ],
        liveStore,
      );
      fireEvent.click(await within(typeGroup()).findByRole('radio', { name: 'Trailing stop' }));
      const choice = await screen.findByRole('radiogroup', { name: 'Position to protect' });
      expect(
        within(choice)
          .getAllByRole('radio')
          .map((r) => r.textContent),
      ).toEqual(['Delivery · 10', 'Intraday · 4']);
      fireEvent.click(within(choice).getByRole('radio', { name: 'Intraday · 4' }));
      expect(screen.getByTestId('trailing-protects')).toHaveTextContent('Sell 4 shares');

      // Back to Market keeps the regular form.
      fireEvent.click(within(typeGroup()).getByRole('radio', { name: 'Market' }));
      expect(await screen.findByRole('radiogroup', { name: 'Order side' })).toBeInTheDocument();
    },
    HEAVY,
  );

  it(
    'shows the option as not available while there is no trading store (signed out or loading)',
    async () => {
      // No trading store provided: the app's idle store, before the account state loads.
      await renderWithPositions([['DELIVERY', 2]]);
      const option = await within(typeGroup()).findByRole('radio', {
        name: 'Not available right now',
      });
      expect(option).toBeDisabled();
      expect(screen.getByText(/loaded. Try again in a moment/)).toBeInTheDocument();
    },
    HEAVY,
  );
});
