import { createTradingStore, type ApiClient } from '@nthstock/apiClient';
import { fixedClock, fromIst } from '@nthstock/utils';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
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

/** Monday 28 Sep 2026, 10:00 IST: NSE is open, so a market buy fills at once. */
const OPEN_MS = fromIst(2026, 9, 28, 10 * 60).getTime();
const HEAVY = 20_000;

function Harness() {
  const openTicket = useOpenTicket();
  return (
    <>
      <main id="main" tabIndex={-1}>
        <button
          type="button"
          onClick={() => void openTicket({ symbol: 'INFY', exchange: 'NSE', side: 'BUY' })}
        >
          Open ticket
        </button>
      </main>
      <OrderTicketHost />
    </>
  );
}

let mobileSeq = 0;
const nextMobile = () => `98145${String(10_000 + (mobileSeq += 1)).slice(-5)}`;

const mock = createMockServer({
  clock: fixedClock(OPEN_MS),
  tickIntervalMs: 1_000_000_000,
  auth: { now: () => OPEN_MS },
});
const session: MarketSession = { clock: fixedClock(OPEN_MS), alwaysOpen: false };

const liveStore = (api: ApiClient) =>
  createTradingStore({
    loadState: () => api.request('accountState'),
    schedule: (flush) => queueMicrotask(flush),
  });

async function openBuyTicket(withStore: boolean) {
  const api = await loginOnMock(nextMobile(), 'http://attached.test');
  const tradingStore = withStore ? liveStore(api) : undefined;
  await tradingStore?.start();
  renderWithProviders(<Harness />, {
    apiClient: api,
    quoteStore: createTestQuoteStore().store,
    marketSession: session,
    ...(tradingStore ? { tradingStore } : {}),
  });
  fireEvent.click(await screen.findByRole('button', { name: 'Open ticket' }));
  const dialog = await screen.findByRole('dialog', { name: 'Trade INFY' });
  await within(dialog).findByRole('form', { name: 'Order details' });
  return { dialog, api, tradingStore };
}

beforeAll(() => mock.server.listen({ onUnhandledFrame: 'error' }));
beforeEach(() => {
  installResizeObserver();
});
afterEach(() => {
  vi.unstubAllGlobals();
  resetSession();
  useTicketIntentStore.setState(initialTicketIntentState);
});
afterAll(() => {
  mock.server.close();
  mock.orders.dispose();
  mock.adapter.dispose();
});

describe('"Add trailing stop" on an entry (T14, SPEC-TFC-1 §6.4, §7)', () => {
  it(
    'previews the stop for the expected fill, restates it in the review, and arms it when the entry fills',
    async () => {
      const { dialog, api, tradingStore } = await openBuyTicket(true);
      const toggle = within(dialog).getByRole('switch', { name: 'Add trailing stop' });
      expect(toggle).not.toBeChecked();
      fireEvent.click(toggle);

      const trail = await within(dialog).findByRole('textbox', { name: 'Trail (%)' });
      fireEvent.change(trail, { target: { value: '1.5' } });
      await waitFor(() =>
        expect(within(dialog).getByTestId('trailing-preview')).toHaveTextContent(
          /^If the entry fills at ₹[\d,]+\.\d\d: initial stop ₹[\d,]+\.\d\d, trails 1\.5% below the high$/,
        ),
      );

      fireEvent.click(within(dialog).getByRole('button', { name: 'Buy INFY' }));
      const attached = await within(dialog).findByTestId('review-attached');
      expect(attached).toHaveTextContent(
        'Once the entry fills, exits with a market order when the price falls from its high by 1.5%.',
      );
      fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm' }));

      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      // The engine arms the stop when the entry fills; the order and the stop share one request.
      const { items: orders } = await api.request('ordersList', { query: {} });
      const entry = orders.find((order) => order.symbol === 'INFY');
      expect(entry).toMatchObject({ side: 'BUY', status: 'EXECUTED' });
      const { items: stops } = await api.request('trailingStopsList');
      expect(stops).toEqual([
        expect.objectContaining({
          status: 'TRAILING',
          direction: 'LONG',
          protectedQty: 1,
          trail: { unit: 'PERCENT', basisPoints: 150 },
          entryOrderId: entry?.id,
        }),
      ]);
      tradingStore?.dispose();
    },
    HEAVY,
  );

  it(
    'blocks the review until the trail is valid',
    async () => {
      const { dialog } = await openBuyTicket(true);
      fireEvent.click(within(dialog).getByRole('switch', { name: 'Add trailing stop' }));
      fireEvent.click(within(dialog).getByRole('button', { name: 'Buy INFY' }));
      expect(await within(dialog).findByText(/Enter a trail/)).toBeInTheDocument();
      expect(within(dialog).queryByTestId('review-attached')).not.toBeInTheDocument();
    },
    HEAVY,
  );

  it(
    'on a phone, opens More options and says why when the hidden trail is invalid',
    async () => {
      vi.stubGlobal('matchMedia', (query: string) => ({
        matches: query.includes('max-width'),
        media: query,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      }));
      const { dialog } = await openBuyTicket(true);
      const more = within(dialog).getByRole('button', { name: /More options/ });
      fireEvent.click(more);
      fireEvent.click(within(dialog).getByRole('switch', { name: 'Add trailing stop' }));
      fireEvent.click(more);
      expect(more).toHaveAttribute('aria-expanded', 'false');

      fireEvent.click(within(dialog).getByRole('button', { name: 'Buy INFY' }));
      await waitFor(() => expect(more).toHaveAttribute('aria-expanded', 'true'));
      expect(more).toBeDisabled();
      expect(
        within(dialog).getByText('Order cannot be placed').closest('[role="alert"]'),
      ).toHaveTextContent(/Enter a trail/);
      expect(within(dialog).getByTestId('attach-trailing')).toBeVisible();
    },
    HEAVY,
  );

  it(
    'is shown as not available until the account has loaded',
    async () => {
      const { dialog } = await openBuyTicket(false);
      const section = within(dialog).getByTestId('attach-trailing');
      expect(within(section).getByRole('switch', { name: 'Add trailing stop' })).toBeDisabled();
      expect(section).toHaveTextContent(
        'Trailing stops are not available until your account has loaded.',
      );
    },
    HEAVY,
  );
});
