import { createApiClient } from '@nthstock/apiClient';
import type { Exchange, OrderSide } from '@nthstock/contracts';
import { fixedClock, formatInr, fromIst } from '@nthstock/utils';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockServer } from '@/mocks/node';
import { useOpenTicket } from '@/shared/hooks/useOpenTicket';
import { useConnectivityStore } from '@/shared/lib/connectivity';
import { orderCue } from '@/shared/motion/orderCues';
import type { MarketSession } from '@/shared/lib/marketSessionContext';
import { initialTicketIntentState, useTicketIntentStore } from '@/shared/lib/ticketIntentStore';
import { createTestQuoteStore, testQuote } from '@/test/quotes';
import { renderWithProviders } from '@/test/renderWithProviders';
import { installResizeObserver } from '@/test/resizeObserver';
import { resetSession, signOut } from '@/test/session';
import { loginOnMock } from '@/test/watchlists';
import { ticketKeys } from '../api/ticketQueries';
import { OrderTicket } from './OrderTicket';
import { OrderTicketHost } from './OrderTicketHost';

// The cue itself (haptic and sound) is tested in orderCues.test.tsx; here we check which one fires.
vi.mock('@/shared/motion/orderCues', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  orderCue: vi.fn(),
}));

/** Monday 28 Sep 2026, 10:00 IST: NSE is open. Saturday 26 Sep, 11:30 IST: closed. */
const OPEN_MS = fromIst(2026, 9, 28, 10 * 60).getTime();
const CLOSED_MS = fromIst(2026, 9, 26, 11 * 60 + 30).getTime();

// Each case logs in and makes several round trips on the MSW node server; CI runners are slow.
const HEAVY = 20_000;

/**
 * One MSW node server per clock: the mock market, auth and the paper engine all read it, so the
 * engine answers OPEN/EXECUTED at 10:00 on a Monday and AMO on a Saturday, and nothing ticks.
 */
function mockAt(at: number) {
  const mock = createMockServer({
    clock: fixedClock(at),
    tickIntervalMs: 1_000_000_000,
    auth: { now: () => at },
  });
  const session: MarketSession = { clock: fixedClock(at), alwaysOpen: false };
  return { ...mock, session };
}

function Harness({ symbol = 'INFY', exchange = 'NSE' }: { symbol?: string; exchange?: Exchange }) {
  const openTicket = useOpenTicket();
  const trade = (side: OrderSide) => void openTicket({ symbol, exchange, side });
  return (
    <>
      <main id="main" tabIndex={-1}>
        <button type="button" onClick={() => trade('BUY')}>{`Buy ${symbol}`}</button>
        <button type="button" onClick={() => trade('SELL')}>{`Sell ${symbol}`}</button>
      </main>
      <OrderTicketHost />
    </>
  );
}

let mobileSeq = 0;
const nextMobile = () => `98133${String(10_000 + (mobileSeq += 1)).slice(-5)}`;

async function renderTicket(session: MarketSession, options: { signedIn?: boolean } = {}) {
  const apiClient = await loginOnMock(nextMobile(), 'http://ticket.test');
  if (options.signedIn === false) signOut();
  const quotes = createTestQuoteStore();
  const view = renderWithProviders(<Harness />, {
    apiClient,
    quoteStore: quotes.store,
    marketSession: session,
  });
  return { ...view, quotes, apiClient };
}

const qtyInput = () => screen.getByRole('textbox', { name: 'Quantity' });
const priceInput = () => screen.getByRole('textbox', { name: 'Price (₹)' });

/** Clicks Buy/Sell (focused first, as a real click would) and waits for the loaded form. */
async function openTicket(side: 'Buy' | 'Sell' = 'Buy') {
  const button = await screen.findByRole('button', { name: `${side} INFY` });
  button.focus();
  fireEvent.click(button);
  const dialog = await screen.findByRole('dialog', { name: 'Trade INFY' });
  await within(dialog).findByRole('form', { name: 'Order details' });
  // The REST snapshot has arrived once the price is prefilled with the LTP.
  await waitFor(() => expect(priceInput()).not.toHaveValue(''));
  return { dialog, button };
}

beforeEach(() => {
  installResizeObserver();
});
afterEach(() => {
  vi.unstubAllGlobals();
  resetSession();
  useConnectivityStore.getState().setForced('live');
  useTicketIntentStore.setState(initialTicketIntentState);
  vi.restoreAllMocks();
});

// jsdom has no AnimationEvent, so the init's animationName is dropped; set it on the event.
function animationEnd(target: Element, animationName: string) {
  // React listens on the vendor-prefixed name when jsdom's style object exposes WebkitAnimation.
  const type = 'WebkitAnimation' in document.body.style ? 'webkitAnimationEnd' : 'animationend';
  const event = Object.assign(new Event(type, { bubbles: true }), { animationName });
  fireEvent(target, event);
}

describe('order ticket with the market open', () => {
  const mock = mockAt(OPEN_MS);
  beforeAll(() => mock.server.listen({ onUnhandledFrame: 'error' }));
  beforeEach(() => vi.mocked(orderCue).mockClear());
  afterEach(() => mock.server.resetHandlers());
  afterAll(() => {
    mock.server.close();
    mock.orders.dispose();
    mock.adapter.dispose();
  });

  it(
    'opens from Buy as a slide-over, closes on Esc and returns focus to Buy (T-135)',
    async () => {
      await renderTicket(mock.session);
      const { dialog, button } = await openTicket();
      expect(dialog).toHaveAccessibleDescription(/Paper order with virtual cash/);
      // Focus moved into the ticket: the quantity field once it loaded.
      await waitFor(() => expect(qtyInput()).toHaveFocus());
      // The page stays in view behind a light overlay.
      expect(document.querySelector('[data-overlay="light"]')).not.toBeNull();

      fireEvent.keyDown(document.activeElement ?? dialog, { key: 'Escape' });
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      expect(useTicketIntentStore.getState().intent).toBeNull();
      await waitFor(() => expect(button).toHaveFocus());
    },
    HEAVY,
  );

  it(
    'offline: the order button is disabled with the reason attached, and works again on reconnect (CR-1 §7)',
    async () => {
      await renderTicket(mock.session);
      await openTicket();
      const submit = () => within(screen.getByTestId('ticket-primary')).getByRole('button');
      expect(submit()).toBeEnabled();

      act(() => useConnectivityStore.getState().setForced('offline'));
      const message = await screen.findByText("You're offline. Orders resume when you reconnect.");
      expect(submit()).toBeDisabled();
      expect(submit()).toHaveAccessibleDescription(message.textContent);

      act(() => useConnectivityStore.getState().setForced('live'));
      await waitFor(() => expect(submit()).toBeEnabled());
      expect(screen.queryByText(/You're offline/)).not.toBeInTheDocument();
    },
    HEAVY,
  );

  it(
    'offline: the review step Confirm is disabled with the reason attached, and works again on reconnect (CR-1 §7)',
    async () => {
      await renderTicket(mock.session);
      await openTicket();
      fireEvent.change(qtyInput(), { target: { value: '2' } });
      fireEvent.click(screen.getByRole('button', { name: 'Buy INFY' }));
      await screen.findByRole('heading', { name: 'Review your order' });
      expect(screen.getByRole('button', { name: 'Confirm' })).toBeEnabled();

      act(() => useConnectivityStore.getState().setForced('offline'));
      const message = await screen.findByText("You're offline. Orders resume when you reconnect.");
      const confirm = screen.getByRole('button', { name: 'Confirm' });
      expect(confirm).toBeDisabled();
      expect(confirm).toHaveAccessibleDescription(message.textContent);

      act(() => useConnectivityStore.getState().setForced('live'));
      await waitFor(() => expect(screen.getByRole('button', { name: 'Confirm' })).toBeEnabled());
      expect(screen.queryByText(/You're offline/)).not.toBeInTheDocument();
    },
    HEAVY,
  );

  it(
    'a signed-out Buy keeps the intent and does not open until a session is held',
    async () => {
      const { router } = await renderTicket(mock.session, { signedIn: false });
      fireEvent.click(await screen.findByRole('button', { name: 'Buy INFY' }));
      await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
      expect(useTicketIntentStore.getState().intent).toMatchObject({ symbol: 'INFY' });
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    },
    HEAVY,
  );

  it(
    'prefills the price with the LTP, disabled for a market order, with live LTP and amounts (T-136)',
    async () => {
      const { quotes } = await renderTicket(mock.session);
      await openTicket();
      const snapshot = await mock.adapter.getQuote('INFY');
      const ltp = snapshot?.ltp ?? 0;
      await waitFor(() => expect(priceInput()).toHaveValue((ltp / 100).toFixed(2)));
      expect(priceInput()).toBeDisabled();
      expect(screen.getByRole('radio', { name: 'Buy' })).toHaveAttribute('aria-checked', 'true');
      // The selected Buy is solid brand blue, like the trade bar's Buy (SPEC-CR-1 §4.1).
      expect(screen.getByRole('radio', { name: 'Buy' }).className).toContain(
        'data-[state=checked]:bg-brand',
      );
      expect(screen.getByRole('radio', { name: 'Market' })).toHaveAttribute('aria-checked', 'true');
      expect(screen.getByRole('radio', { name: 'Delivery' })).toHaveAttribute(
        'aria-checked',
        'true',
      );
      // Paper funds: ₹10,00,000 to start.
      await waitFor(() =>
        expect(screen.getByTestId('available-cash')).toHaveTextContent('₹10,00,000.00'),
      );
      expect(screen.getByText('Required amount')).toBeInTheDocument();
      expect(screen.getByTestId('order-value')).toHaveTextContent(formatInr(ltp));

      // A live tick revalues the market order; the quantity multiplies it.
      act(() => quotes.push(testQuote('INFY', 150_000)));
      fireEvent.change(qtyInput(), { target: { value: '3' } });
      await waitFor(() => expect(screen.getByTestId('order-value')).toHaveTextContent('₹4,500.00'));

      // Limit enables the price; the value follows it.
      fireEvent.click(screen.getByRole('radio', { name: 'Limit' }));
      expect(priceInput()).toBeEnabled();
      fireEvent.change(priceInput(), { target: { value: '1400' } });
      await waitFor(() => expect(screen.getByTestId('order-value')).toHaveTextContent('₹4,200.00'));

      // Sell says "Estimated value" and the button follows the side.
      fireEvent.click(screen.getByRole('radio', { name: 'Sell' }));
      expect(screen.getByText('Estimated value')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Sell INFY' })).toBeInTheDocument();
    },
    HEAVY,
  );

  it(
    'shows inline errors for qty 0 and a price off the 5-paise tick (T-136)',
    async () => {
      await renderTicket(mock.session);
      await openTicket();
      fireEvent.change(qtyInput(), { target: { value: '0' } });
      expect(await screen.findByText('Quantity must be at least 1')).toBeInTheDocument();
      expect(qtyInput()).toHaveAttribute('aria-invalid', 'true');

      fireEvent.click(screen.getByRole('radio', { name: 'Limit' }));
      fireEvent.change(priceInput(), { target: { value: '1500.03' } });
      expect(await screen.findByText('Price must be a multiple of 5 paise')).toBeInTheDocument();
      expect(priceInput()).toHaveAttribute('aria-invalid', 'true');

      // Submitting keeps the ticket on the form.
      fireEvent.click(screen.getByRole('button', { name: 'Buy INFY', hidden: false }));
      await waitFor(() => expect(qtyInput()).toBeInTheDocument());
      expect(screen.queryByRole('heading', { name: 'Review your order' })).not.toBeInTheDocument();

      fireEvent.change(qtyInput(), { target: { value: '' } });
      expect(await screen.findByText('Enter a quantity')).toBeInTheDocument();
      fireEvent.change(priceInput(), { target: { value: '' } });
      expect(await screen.findByText('Enter a limit price')).toBeInTheDocument();
    },
    HEAVY,
  );

  it(
    'clicking a bid in the depth panel sets the price and switches the type to Limit (T-137)',
    async () => {
      await renderTicket(mock.session);
      await openTicket();
      const depth = await mock.adapter.getDepth('INFY');
      const bid = depth?.bids[1];
      if (!bid) throw new Error('INFY has no depth');
      expect(screen.getByRole('radio', { name: 'Market' })).toHaveAttribute('aria-checked', 'true');
      const bidButton = await screen.findByRole('button', {
        name: new RegExp(`^${formatInr(bid.price).replace('.', '\\.')} [\\d,]+ shares, bid`),
      });
      fireEvent.click(bidButton);
      expect(screen.getByRole('radio', { name: 'Limit' })).toHaveAttribute('aria-checked', 'true');
      expect(priceInput()).toBeEnabled();
      expect(priceInput()).toHaveValue((bid.price / 100).toFixed(2));
      // Offers fill the price the same way.
      const ask = depth?.asks[0];
      if (!ask) throw new Error('INFY has no offers');
      fireEvent.click(
        screen.getByRole('button', {
          name: new RegExp(`^${formatInr(ask.price).replace('.', '\\.')} [\\d,]+ shares, offer`),
        }),
      );
      expect(priceInput()).toHaveValue((ask.price / 100).toFixed(2));
    },
    HEAVY,
  );

  it(
    'reviews, confirms, toasts with a link to the order book, closes and invalidates orders and funds (T-139)',
    async () => {
      const { queryClient } = await renderTicket(mock.session);
      const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
      await openTicket();
      fireEvent.change(qtyInput(), { target: { value: '2' } });
      fireEvent.click(screen.getByRole('button', { name: 'Buy INFY' }));

      const heading = await screen.findByRole('heading', { name: 'Review your order' });
      await waitFor(() => expect(heading).toHaveFocus());
      const summary = heading.closest('section') as HTMLElement;
      expect(within(summary).getByText('INFY · NSE')).toBeInTheDocument();
      expect(within(summary).getByText('2')).toBeInTheDocument();
      expect(within(summary).getByText(/^At market \(last ₹/)).toBeInTheDocument();
      expect(within(summary).getByText('Delivery')).toBeInTheDocument();

      // Edit goes back with the values kept.
      fireEvent.click(within(summary).getByRole('button', { name: 'Edit' }));
      await waitFor(() => expect(qtyInput()).toHaveValue('2'));

      // The step-back slide survives a child's animation end and clears on its own.
      const slide = qtyInput().closest('.animate-step-back') as HTMLElement;
      expect(slide).not.toBeNull();
      animationEnd(qtyInput(), 'nth-digit-up');
      expect(slide).toHaveClass('animate-step-back');
      animationEnd(slide, 'nth-step-back');
      expect(slide).not.toHaveClass('animate-step-back');

      fireEvent.click(screen.getByRole('button', { name: 'Buy INFY' }));
      const confirm = await screen.findByRole('button', { name: 'Confirm' });
      fireEvent.click(confirm);

      // The Confirm button draws its tick and the ticket stays up for the hold, then closes (A17).
      expect(await screen.findByTestId('success-check')).toBeInTheDocument();
      expect(screen.getByRole('dialog', { name: 'Trade INFY' })).toBeInTheDocument();
      expect(orderCue).toHaveBeenCalledExactlyOnceWith('filledBuy');
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      expect(useTicketIntentStore.getState().intent).toBeNull();
      expect((await screen.findAllByText('Order executed')).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/^BUY 2 INFY @ ₹/).length).toBeGreaterThan(0);
      expect(screen.getByRole('link', { name: 'View orders' })).toHaveAttribute('href', '/orders');
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ['orders'] });
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ['funds'] });
      await waitFor(() => expect(screen.getByRole('button', { name: 'Buy INFY' })).toHaveFocus());
    },
    HEAVY,
  );

  it(
    'a rejected order keeps the form values and shows the reason inline (T-139)',
    async () => {
      const { queryClient } = await renderTicket(mock.session);
      const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
      await openTicket('Sell');
      fireEvent.change(qtyInput(), { target: { value: '5' } });
      fireEvent.click(screen.getByRole('button', { name: 'Sell INFY' }));
      fireEvent.click(await screen.findByRole('button', { name: 'Confirm' }));

      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent('Not enough shares');
      expect(orderCue).toHaveBeenCalledExactlyOnceWith('rejected');
      expect(screen.queryByTestId('success-check')).not.toBeInTheDocument();
      expect(alert).toHaveTextContent('You have no INFY shares to sell for delivery.');
      await waitFor(() => expect(alert).toHaveFocus());
      // Still open, still SELL 5 delivery at market.
      expect(screen.getByRole('dialog', { name: 'Trade INFY' })).toBeInTheDocument();
      expect(qtyInput()).toHaveValue('5');
      expect(screen.getByRole('radio', { name: 'Sell' })).toHaveAttribute('aria-checked', 'true');
      expect(screen.getByRole('radio', { name: 'Market' })).toHaveAttribute('aria-checked', 'true');
      // The server stored a REJECTED order, so the order book refreshes too.
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ['orders'] });
    },
    HEAVY,
  );

  it(
    'refuses a buy beyond the available cash before review, in the engine’s words',
    async () => {
      await renderTicket(mock.session);
      await openTicket();
      await waitFor(() =>
        expect(screen.getByTestId('available-cash')).toHaveTextContent('₹10,00,000.00'),
      );
      fireEvent.change(qtyInput(), { target: { value: '100000' } });
      expect(await screen.findByText('More than your available cash')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Buy INFY' }));
      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent('Order cannot be placed');
      expect(alert).toHaveTextContent(/^.*Not enough cash: this order needs/);
      expect(screen.queryByRole('heading', { name: 'Review your order' })).not.toBeInTheDocument();
    },
    HEAVY,
  );

  it(
    'puts a limit price outside the circuit band on the price field',
    async () => {
      const { queryClient } = await renderTicket(mock.session);
      await openTicket();
      const stats = await mock.adapter.getStats('INFY');
      if (!stats) throw new Error('INFY has no stats');
      // The band comes from the stats query; wait for it before submitting.
      await waitFor(() =>
        expect(
          queryClient.getQueryState(ticketKeys.stats({ symbol: 'INFY', exchange: 'NSE' }))?.status,
        ).toBe('success'),
      );
      fireEvent.click(screen.getByRole('radio', { name: 'Limit' }));
      fireEvent.change(priceInput(), {
        target: { value: ((stats.upperCircuit + 1_000) / 100).toFixed(2) },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Buy INFY' }));
      expect(await screen.findByText(/outside today's range for INFY/)).toBeInTheDocument();
      expect(priceInput()).toHaveAttribute('aria-invalid', 'true');
      expect(screen.queryByRole('heading', { name: 'Review your order' })).not.toBeInTheDocument();
    },
    HEAVY,
  );

  it(
    'from the chart: a compact limit at the chart price, warning when it would fill at once (T17)',
    async () => {
      await renderTicket(mock.session);
      await screen.findByRole('button', { name: 'Buy INFY' });
      // ₹9,99,999.95 is far above any LTP: a buy there crosses the market.
      act(() => {
        useTicketIntentStore.getState().openTicket({
          symbol: 'INFY',
          exchange: 'NSE',
          side: 'BUY',
          price: 99_999_995,
          compact: true,
        });
      });
      const dialog = await screen.findByRole('dialog', { name: 'Trade INFY' });
      await within(dialog).findByRole('form', { name: 'Order details' });
      expect(priceInput()).toHaveValue('999999.95');
      // Side, quantity, price, product and the trailing stop; no type switch, no depth.
      expect(within(dialog).getByRole('radiogroup', { name: 'Order side' })).toBeInTheDocument();
      expect(within(dialog).getByRole('radiogroup', { name: 'Product' })).toBeInTheDocument();
      expect(within(dialog).queryByRole('radiogroup', { name: 'Order type' })).toBeNull();
      expect(within(dialog).queryByRole('region', { name: 'Market depth' })).toBeNull();
      expect(within(dialog).getByTestId('attach-trailing')).toBeInTheDocument();
      expect(await within(dialog).findByTestId('fills-immediately')).toHaveTextContent(
        'This will fill immediately',
      );

      // As a sell at that price it rests on the book: no warning.
      fireEvent.click(within(dialog).getByRole('radio', { name: 'Sell' }));
      await waitFor(() => expect(within(dialog).queryByTestId('fills-immediately')).toBeNull());
    },
    HEAVY,
  );

  describe('on a phone (CR-T11)', () => {
    const stubViewport = (phone: boolean) =>
      vi.stubGlobal('matchMedia', (query: string) => ({
        matches: phone && query.includes('max-width'),
        media: query,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      }));

    it(
      'hides product, depth and the stop behind More options, pinning the primary button',
      async () => {
        stubViewport(true);
        await renderTicket(mock.session);
        const { dialog } = await openTicket();
        expect(within(dialog).queryByRole('radiogroup', { name: 'Product' })).toBeNull();
        expect(within(dialog).queryByTestId('attach-trailing')).toBeNull();
        expect(within(dialog).getByRole('radiogroup', { name: 'Order type' })).toBeInTheDocument();

        const toggle = within(dialog).getByRole('button', { name: /More options/ });
        expect(toggle).toHaveAttribute('aria-expanded', 'false');
        expect(toggle).toHaveTextContent('Delivery');
        fireEvent.click(toggle);
        expect(toggle).toHaveAttribute('aria-expanded', 'true');
        expect(within(dialog).getByRole('radiogroup', { name: 'Product' })).toBeInTheDocument();
        expect(within(dialog).getByTestId('attach-trailing')).toBeInTheDocument();

        // The submit button lives in the pinned footer, and its variant follows the side.
        const submit = within(within(dialog).getByTestId('ticket-primary')).getByRole('button', {
          name: /Buy INFY/,
        });
        const buyClass = submit.className;
        fireEvent.click(within(dialog).getByRole('radio', { name: 'Sell' }));
        const sell = within(within(dialog).getByTestId('ticket-primary')).getByRole('button', {
          name: /Sell INFY/,
        });
        expect(sell.className).not.toBe(buyClass);
      },
      HEAVY,
    );

    it(
      'has a ruler that follows focus between quantity and price',
      async () => {
        stubViewport(true);
        await renderTicket(mock.session);
        const { dialog } = await openTicket();
        const qtyRuler = within(dialog).getByRole('slider', { name: 'Adjust quantity' });
        const qtyBefore = Number(qtyRuler.getAttribute('aria-valuenow'));
        fireEvent.keyDown(qtyRuler, { key: 'ArrowRight' });
        await waitFor(() =>
          expect(within(dialog).getByRole('slider', { name: 'Adjust quantity' })).toHaveAttribute(
            'aria-valuenow',
            String(qtyBefore + 1),
          ),
        );

        fireEvent.click(within(dialog).getByRole('radio', { name: 'Limit' }));
        fireEvent.focusIn(priceInput());
        const priceRuler = await within(dialog).findByRole('slider', { name: 'Adjust price' });
        const priceBefore = priceRuler.getAttribute('aria-valuenow');
        fireEvent.keyDown(priceRuler, { key: 'ArrowRight' });
        await waitFor(() =>
          expect(
            within(dialog)
              .getByRole('slider', { name: 'Adjust price' })
              .getAttribute('aria-valuenow'),
          ).not.toBe(priceBefore),
        );

        fireEvent.focusIn(qtyInput());
        expect(
          await within(dialog).findByRole('slider', { name: 'Adjust quantity' }),
        ).toBeInTheDocument();
      },
      HEAVY,
    );

    it(
      'keeps the ruler on quantity for a market order with price focused',
      async () => {
        stubViewport(true);
        await renderTicket(mock.session);
        const { dialog } = await openTicket();
        fireEvent.click(within(dialog).getByRole('radio', { name: 'Market' }));
        fireEvent.focusIn(priceInput());
        expect(within(dialog).getByRole('slider', { name: 'Adjust quantity' })).toBeInTheDocument();
        expect(within(dialog).queryByRole('slider', { name: 'Adjust price' })).toBeNull();
      },
      HEAVY,
    );

    it(
      'shows product inline and no toggle on wider screens',
      async () => {
        stubViewport(false);
        await renderTicket(mock.session);
        const { dialog } = await openTicket();
        expect(within(dialog).queryByRole('button', { name: /More options/ })).toBeNull();
        expect(within(dialog).getByRole('radiogroup', { name: 'Product' })).toBeInTheDocument();
        expect(within(dialog).queryByTestId('ticket-ruler')).toBeNull();
      },
      HEAVY,
    );
  });
});

describe('order ticket with the market closed (T-138)', () => {
  const mock = mockAt(CLOSED_MS);
  beforeAll(() => mock.server.listen({ onUnhandledFrame: 'error' }));
  beforeEach(() => vi.mocked(orderCue).mockClear());
  afterEach(() => mock.server.resetHandlers());
  afterAll(() => {
    mock.server.close();
    mock.orders.dispose();
    mock.adapter.dispose();
  });

  it(
    'shows the AMO banner and Place AMO, disables intraday, and places an AMO',
    async () => {
      await renderTicket(mock.session);
      await openTicket();
      // Saturday 26 Sep → Monday 28 Sep, formatted as the ticket shows IST dates.
      const date = new Intl.DateTimeFormat('en-IN', {
        timeZone: 'Asia/Kolkata',
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      }).format(fromIst(2026, 9, 28, 9 * 60 + 15));
      expect(
        screen.getByText(
          `Market is closed. Your order will be placed as AMO at 9:15 AM on ${date}.`,
        ),
      ).toBeInTheDocument();
      expect(screen.getByRole('radio', { name: 'Intraday' })).toBeDisabled();
      expect(
        screen.getByText('Intraday is available 9:15 AM to 3:20 PM IST on trading days.'),
      ).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Place AMO' }));
      const heading = await screen.findByRole('heading', { name: 'Review your order' });
      const summary = heading.closest('section') as HTMLElement;
      expect(
        within(summary).getByText(`Goes to the exchange at 9:15 AM on ${date}.`),
      ).toBeInTheDocument();
      fireEvent.click(within(summary).getByRole('button', { name: 'Confirm AMO' }));

      expect(await screen.findByTestId('success-check')).toBeInTheDocument();
      expect(orderCue).toHaveBeenCalledExactlyOnceWith('placed');
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      expect((await screen.findAllByText('AMO placed')).length).toBeGreaterThan(0);
    },
    HEAVY,
  );
});

describe('order ticket load states', () => {
  it('shows a retryable error when the instrument cannot load', async () => {
    renderWithProviders(
      <OrderTicket intent={{ symbol: 'INFY', exchange: 'NSE', side: 'BUY' }} onClose={vi.fn()} />,
    );
    expect(await screen.findByText('The order ticket could not load')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it(
    'has no order form for an index',
    async () => {
      const mock = mockAt(OPEN_MS);
      mock.server.listen({ onUnhandledFrame: 'error' });
      try {
        // The instrument is public: no login needed.
        const apiClient = createApiClient({ baseUrl: 'http://ticket.test' });
        renderWithProviders(
          <OrderTicket
            intent={{ symbol: 'NIFTY50', exchange: 'NSE', side: 'BUY' }}
            onClose={vi.fn()}
          />,
          { apiClient },
        );
        expect(
          await screen.findByText('Only stocks can be traded. Indices have no orders.'),
        ).toBeInTheDocument();
      } finally {
        mock.server.close();
        mock.orders.dispose();
        mock.adapter.dispose();
      }
    },
    HEAVY,
  );
});
