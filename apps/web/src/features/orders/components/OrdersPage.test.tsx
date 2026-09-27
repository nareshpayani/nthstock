import type { ApiClient } from '@nthstock/apiClient';
import type { Order, PlaceOrderRequest } from '@nthstock/contracts';
import { fixedClock, formatInr, fromIst } from '@nthstock/utils';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { OrderTicketHost } from '@/features/orderTicket';
import { createMockServer } from '@/mocks/node';
import { resetFillToasts } from '@/shared/lib/fillToasts';
import type { MarketSession } from '@/shared/lib/marketSessionContext';
import type { OrderUpdateSource } from '@/shared/lib/orderUpdatesContext';
import { initialSearchFocusState, useSearchFocusStore } from '@/shared/lib/searchFocusStore';
import { initialTicketIntentState, useTicketIntentStore } from '@/shared/lib/ticketIntentStore';
import { createTestQuoteStore } from '@/test/quotes';
import { renderWithProviders } from '@/test/renderWithProviders';
import { installResizeObserver } from '@/test/resizeObserver';
import { resetSession } from '@/test/session';
import { fakeLayout, findStock, loginOnMock } from '@/test/watchlists';
import { VIRTUAL_ORDER_ROWS } from './OrderTable';
import { OrderUpdatesBridge } from './OrderUpdatesBridge';
import { OrdersPage, type OrdersSearch } from './OrdersPage';

/** Monday 28 Sep 2026, 10:00 IST: NSE is open. */
const OPEN_MS = fromIst(2026, 9, 28, 10 * 60).getTime();
// Each case logs in and makes several round trips on the MSW node server; CI runners are slow.
const HEAVY = 30_000;

const mock = createMockServer({
  clock: fixedClock(OPEN_MS),
  tickIntervalMs: 1_000_000_000,
  auth: { now: () => OPEN_MS },
});
const session: MarketSession = { clock: fixedClock(OPEN_MS), alwaysOpen: false };

/** Forwards the mock's order updates, as the app's WebSocket would (T-147). */
function mockOrderUpdates(): OrderUpdateSource & { connects: number } {
  const source = {
    connects: 0,
    onOrderUpdate: (listener: (order: Order) => void) =>
      mock.orders.onOrderUpdate((_userId, order) => listener(order)),
    connect: () => {
      source.connects += 1;
    },
  };
  return source;
}

function Harness({ initial = {} }: { initial?: OrdersSearch }) {
  const [search, setSearch] = useState<OrdersSearch>(initial);
  return (
    <>
      <main id="main" tabIndex={-1}>
        <OrdersPage
          search={search}
          onSearchChange={(patch) => setSearch({ ...search, ...patch })}
        />
      </main>
      <OrderTicketHost />
      <OrderUpdatesBridge />
    </>
  );
}

let mobileSeq = 0;
const nextMobile = () => `98144${String(10_000 + (mobileSeq += 1)).slice(-5)}`;

type Setup = { api: ApiClient; token: number; ltp: number };

async function setup(): Promise<Setup> {
  const api = await loginOnMock(nextMobile(), 'http://orders.test');
  const { token } = await findStock(api, 'INFY');
  const quote = await mock.adapter.getQuote('INFY');
  const ltp = Math.round((quote?.ltp ?? 150_000) / 5) * 5;
  mock.orders.pinPrice(token, ltp);
  return { api, token, ltp };
}

const place = (api: ApiClient, token: number, extra: Partial<PlaceOrderRequest>) =>
  api.request('orderPlace', {
    body: { token, side: 'BUY', type: 'MARKET', product: 'DELIVERY', qty: 1, ...extra },
  });

function renderBook(api: ApiClient, initial: OrdersSearch = {}) {
  const quotes = createTestQuoteStore();
  const orderUpdates = mockOrderUpdates();
  const view = renderWithProviders(<Harness initial={initial} />, {
    apiClient: api,
    quoteStore: quotes.store,
    marketSession: session,
    orderUpdates,
  });
  return { ...view, orderUpdates };
}

const tab = (name: RegExp) => screen.findByRole('tab', { name });

/** Radix tabs switch on mouse down (and on focus with the keyboard). */
async function openTab(name: RegExp) {
  const trigger = await tab(name);
  fireEvent.mouseDown(trigger, { button: 0 });
  await waitFor(() => expect(trigger).toHaveAttribute('aria-selected', 'true'));
}

const rows = (label: string) =>
  within(screen.getByRole('table', { name: label }))
    .getAllByRole('row')
    .slice(1);

beforeAll(() => {
  mock.server.listen({ onUnhandledRequest: 'error' });
});
beforeEach(() => {
  installResizeObserver();
});
afterEach(() => {
  resetSession();
  resetFillToasts();
  useTicketIntentStore.setState(initialTicketIntentState);
});
afterAll(() => {
  mock.server.close();
  mock.orders.dispose();
  mock.adapter.dispose();
});

describe('order book (T-144)', () => {
  it(
    'shows Open, Executed and Cancelled (with Rejected) tabs whose counts match their rows',
    async () => {
      const { api, token, ltp } = await setup();
      await place(api, token, { qty: 2 }); // EXECUTED
      const open = await place(api, token, { type: 'LIMIT', price: ltp - 500, qty: 4 });
      const gone = await place(api, token, { type: 'LIMIT', price: ltp - 1_000 });
      await api.request('orderCancel', { params: { id: gone.id } });
      await place(api, token, { qty: 1_000_000 }).catch(() => undefined); // REJECTED (422)

      renderBook(api);
      expect(await tab(/^Open \(1\)$/)).toHaveAttribute('aria-selected', 'true');
      expect(await tab(/^Executed \(1\)$/)).toBeInTheDocument();
      expect(await tab(/^Cancelled \(2\)$/)).toBeInTheDocument();

      const openRows = rows('Open orders');
      expect(openRows).toHaveLength(1);
      const cells = within(openRows[0] as HTMLElement).getAllByRole('cell');
      expect(cells.map((cell) => cell.textContent)).toEqual([
        expect.stringMatching(/^10:00:00 (am|AM)$/),
        'INFYNSE',
        'Buy',
        'Limit',
        'Delivery',
        '0 / 4',
        formatInr(ltp - 500),
        'Open',
        'DetailsModifyCancel',
      ]);
      expect(
        within(openRows[0] as HTMLElement).getByRole('button', { name: 'Modify BUY 4 INFY order' }),
      ).toBeInTheDocument();
      expect(open.status).toBe('OPEN');

      await openTab(/^Executed/);
      const executed = rows('Executed orders');
      expect(executed).toHaveLength(1);
      expect(executed[0]).toHaveTextContent(formatInr(ltp));
      expect(executed[0]).toHaveTextContent('Executed');
      // Executed orders cannot be modified or cancelled.
      expect(
        within(executed[0] as HTMLElement).queryByRole('button', { name: /^Modify/ }),
      ).toBeNull();

      await openTab(/^Cancelled/);
      const cancelled = rows('Cancelled orders');
      expect(cancelled.map((row) => within(row).getAllByRole('cell')[7]?.textContent)).toEqual([
        'Rejected',
        'Cancelled',
      ]);
    },
    HEAVY,
  );

  it(
    'shows an empty state per tab, whose button opens search (T-153)',
    async () => {
      const { api } = await setup();
      renderBook(api, { tab: 'executed' });
      expect(await screen.findByText('No executed orders')).toBeInTheDocument();
      expect(await tab(/^Open \(0\)$/)).toBeInTheDocument();
      const panel = screen.getByRole('tabpanel', { name: /Executed/ });
      fireEvent.click(within(panel).getByRole('button', { name: 'Search stocks' }));
      expect(useSearchFocusStore.getState().requests).toBe(1);
      useSearchFocusStore.setState(initialSearchFocusState);
    },
    HEAVY,
  );

  it(
    'virtualises a book of more than 50 rows',
    async () => {
      const restore = fakeLayout(640);
      try {
        const { api, token, ltp } = await setup();
        for (let i = 0; i <= VIRTUAL_ORDER_ROWS; i += 1) {
          await place(api, token, { type: 'LIMIT', price: ltp - 1_000 - i * 5 });
        }
        renderBook(api);
        const grid = await screen.findByRole('grid', { name: 'Open orders' });
        expect(grid).toHaveAttribute('aria-rowcount', String(VIRTUAL_ORDER_ROWS + 2));
        expect(await tab(/^Open \(51\)$/)).toBeInTheDocument();
        expect(within(grid).getAllByRole('row').length).toBeLessThan(VIRTUAL_ORDER_ROWS);
      } finally {
        restore();
      }
    },
    HEAVY,
  );
});

describe('modify and cancel (T-145)', () => {
  it(
    'modifies qty and price in the ticket; the new price shows in the list',
    async () => {
      const { api, token, ltp } = await setup();
      await place(api, token, { type: 'LIMIT', price: ltp - 500, qty: 4 });
      renderBook(api);
      const modify = await screen.findByRole('button', { name: 'Modify BUY 4 INFY order' });
      modify.focus();
      fireEvent.click(modify);

      const dialog = await screen.findByRole('dialog', { name: 'Modify INFY order' });
      const price = await within(dialog).findByRole('textbox', { name: 'Price (₹)' });
      await waitFor(() => expect(price).toHaveValue(((ltp - 500) / 100).toFixed(2)));
      // Only quantity and price can change.
      for (const name of ['Order side', 'Product', 'Order type']) {
        const group = within(dialog).getByRole('radiogroup', { name });
        for (const radio of within(group).getAllByRole('radio')) expect(radio).toBeDisabled();
      }
      const qty = within(dialog).getByRole('textbox', { name: 'Quantity' });
      fireEvent.change(qty, { target: { value: '6' } });
      fireEvent.change(price, { target: { value: ((ltp - 1_000) / 100).toFixed(2) } });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Review changes' }));
      fireEvent.click(await within(dialog).findByRole('button', { name: 'Modify order' }));

      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      expect(await screen.findByText('Order modified')).toBeInTheDocument();
      await waitFor(() => expect(rows('Open orders')[0]).toHaveTextContent(formatInr(ltp - 1_000)));
      expect(rows('Open orders')[0]).toHaveTextContent('0 / 6');
      // Focus goes back to Modify on the same row.
      await waitFor(() => expect(modify).toHaveFocus());
    },
    HEAVY,
  );

  it(
    'keeps the ticket open with the reason when the order filled before the modify',
    async () => {
      const { api, token, ltp } = await setup();
      await place(api, token, { type: 'LIMIT', price: ltp - 500, qty: 4 });
      renderBook(api);
      fireEvent.click(await screen.findByRole('button', { name: 'Modify BUY 4 INFY order' }));
      const dialog = await screen.findByRole('dialog', { name: 'Modify INFY order' });
      fireEvent.change(await within(dialog).findByRole('textbox', { name: 'Quantity' }), {
        target: { value: '5' },
      });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Review changes' }));
      const confirm = await within(dialog).findByRole('button', { name: 'Modify order' });
      act(() => mock.orders.pinPrice(token, ltp - 500));
      fireEvent.click(confirm);
      const alert = await within(dialog).findByRole('alert');
      expect(alert).toHaveTextContent('Order not modified');
      expect(alert).toHaveTextContent(/already executed, so it can.t be modified/);
      mock.orders.pinPrice(token, ltp);
    },
    HEAVY,
  );

  it(
    'refuses an unchanged modify without calling the server',
    async () => {
      const { api, token, ltp } = await setup();
      await place(api, token, { type: 'LIMIT', price: ltp - 500, qty: 4 });
      renderBook(api);
      fireEvent.click(await screen.findByRole('button', { name: 'Modify BUY 4 INFY order' }));
      const dialog = await screen.findByRole('dialog', { name: 'Modify INFY order' });
      await within(dialog).findByRole('textbox', { name: 'Quantity' });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Review changes' }));
      expect(await within(dialog).findByRole('alert')).toHaveTextContent(
        'Change the quantity or the price to modify this order.',
      );
    },
    HEAVY,
  );

  it(
    'cancels after a confirm; the order moves to the Cancelled tab',
    async () => {
      const { api, token, ltp } = await setup();
      await place(api, token, { type: 'LIMIT', price: ltp - 500, qty: 3 });
      renderBook(api);
      fireEvent.click(await screen.findByRole('button', { name: 'Cancel BUY 3 INFY order' }));
      const confirm = await screen.findByRole('dialog', { name: 'Cancel this order?' });
      expect(confirm).toHaveAccessibleDescription(/Buy 3 INFY .* Delivery\. Any cash blocked/);
      // Keep order closes without cancelling.
      fireEvent.click(within(confirm).getByRole('button', { name: 'Keep order' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      expect(await tab(/^Open \(1\)$/)).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Cancel BUY 3 INFY order' }));
      const again = await screen.findByRole('dialog', { name: 'Cancel this order?' });
      fireEvent.click(within(again).getByRole('button', { name: 'Cancel order' }));
      expect(await screen.findByText('Order cancelled')).toBeInTheDocument();
      expect(await tab(/^Open \(0\)$/)).toBeInTheDocument();
      expect(await tab(/^Cancelled \(1\)$/)).toBeInTheDocument();
      await openTab(/^Cancelled/);
      expect(rows('Cancelled orders')[0]).toHaveTextContent('Cancelled');
    },
    HEAVY,
  );

  it(
    'shows why a cancel was refused when the order filled meanwhile',
    async () => {
      const { api, token, ltp } = await setup();
      await place(api, token, { type: 'LIMIT', price: ltp - 500, qty: 3 });
      renderBook(api);
      const cancel = await screen.findByRole('button', { name: 'Cancel BUY 3 INFY order' });
      fireEvent.click(cancel);
      const confirm = await screen.findByRole('dialog', { name: 'Cancel this order?' });
      // The price falls to the limit while the dialog is open: the order fills first.
      act(() => mock.orders.pinPrice(token, ltp - 500));
      fireEvent.click(within(confirm).getByRole('button', { name: 'Cancel order' }));
      expect(await screen.findByText('Order not cancelled')).toBeInTheDocument();
      expect(screen.getByText(/already executed, so it can.t be cancelled/)).toBeInTheDocument();
      mock.orders.pinPrice(token, ltp);
    },
    HEAVY,
  );
});

describe('order detail drawer (T-146)', () => {
  it(
    'shows every transition with an IST time, and the rejection reason',
    async () => {
      const { api, token, ltp } = await setup();
      const order = await place(api, token, { type: 'LIMIT', price: ltp - 500, qty: 2 });
      await api.request('orderModify', { params: { id: order.id }, body: { qty: 5 } });
      await api.request('orderCancel', { params: { id: order.id } });
      await place(api, token, { qty: 1_000_000 }).catch(() => undefined);

      renderBook(api, { tab: 'cancelled' });
      const details = await screen.findByRole('button', { name: 'Details of BUY 5 INFY order' });
      details.focus();
      fireEvent.click(details);
      const drawer = await screen.findByRole('dialog', { name: 'INFY order' });
      const timeline = await within(drawer).findByRole('list', { name: 'Status timeline' });
      const steps = within(timeline).getAllByRole('listitem');
      expect(steps.map((step) => step.querySelector('p')?.textContent)).toEqual([
        'Placed',
        'Modified',
        'Cancelled',
      ]);
      for (const step of steps) {
        expect(step).toHaveTextContent(/10:00:00 (am|AM) IST, 28 Sept? 2026/);
        expect(step.querySelector('time')).toHaveAttribute(
          'datetime',
          new Date(OPEN_MS).toISOString(),
        );
      }
      expect(within(drawer).getByText('Why it was cancelled')).toBeInTheDocument();
      expect(within(drawer).getAllByText('Cancelled by you.').length).toBeGreaterThan(0);

      fireEvent.keyDown(drawer, { key: 'Escape' });
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      await waitFor(() => expect(details).toHaveFocus());

      fireEvent.click(screen.getByRole('button', { name: 'Details of BUY 1000000 INFY order' }));
      const rejected = await screen.findByRole('dialog', { name: 'INFY order' });
      expect(await within(rejected).findByText('Rejection reason')).toBeInTheDocument();
      expect(within(rejected).getAllByText(/^Not enough cash/).length).toBeGreaterThan(0);
      const [placed] = within(
        await within(rejected).findByRole('list', { name: 'Status timeline' }),
      ).getAllByRole('listitem');
      expect(placed).toHaveTextContent(/Placed · Rejected/);
    },
    HEAVY,
  );

  it(
    'says so when the order in the URL does not exist',
    async () => {
      const { api } = await setup();
      renderBook(api, { order: 'pe_missing' });
      const drawer = await screen.findByRole('dialog', { name: 'Order details' });
      expect(await within(drawer).findByText('This order was not found.')).toBeInTheDocument();
    },
    HEAVY,
  );
});

describe('live order updates (T-147)', () => {
  it(
    'toasts a market fill once, whether the ticket or the update gets there first',
    async () => {
      const { api } = await setup();
      renderBook(api);
      expect(await tab(/^Executed \(0\)$/)).toBeInTheDocument();
      const opener = screen.getByRole('main');
      opener.focus();
      act(() => {
        useTicketIntentStore
          .getState()
          .openTicket({ symbol: 'INFY', exchange: 'NSE', side: 'BUY' });
      });
      const dialog = await screen.findByRole('dialog', { name: 'Trade INFY' });
      await within(dialog).findByRole('form', { name: 'Order details' });
      await waitFor(() =>
        expect(within(dialog).getByRole('textbox', { name: 'Price (₹)' })).not.toHaveValue(''),
      );
      fireEvent.click(within(dialog).getByRole('button', { name: 'Buy INFY' }));
      fireEvent.click(await within(dialog).findByRole('button', { name: 'Confirm' }));
      expect(await tab(/^Executed \(1\)$/)).toBeInTheDocument();
      await waitFor(() => expect(screen.getAllByText('Order executed')).toHaveLength(1));
    },
    HEAVY,
  );

  it(
    'a limit fill moves the row to Executed without a reload, and toasts the fill',
    async () => {
      const { api, token, ltp } = await setup();
      const order = await place(api, token, { type: 'LIMIT', price: ltp - 500, qty: 10 });
      const { orderUpdates } = renderBook(api);
      expect(await tab(/^Open \(1\)$/)).toBeInTheDocument();
      expect(orderUpdates.connects).toBe(1);

      act(() => mock.orders.pinPrice(token, ltp - 500));
      expect(await tab(/^Open \(0\)$/)).toBeInTheDocument();
      expect(await tab(/^Executed \(1\)$/)).toBeInTheDocument();
      expect(await screen.findByText(`BUY 10 INFY @ ${formatInr(ltp - 500)}`)).toBeInTheDocument();
      expect(screen.getByText('Order executed')).toBeInTheDocument();
      await openTab(/^Executed/);
      expect(rows('Executed orders')[0]).toHaveTextContent('10 / 10');
      expect(order.status).toBe('OPEN');
      mock.orders.pinPrice(token, ltp);
    },
    HEAVY,
  );
});
