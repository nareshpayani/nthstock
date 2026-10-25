import { createTradingStore, type ApiClient } from '@nthstock/apiClient';
import { fixedClock, fromIst } from '@nthstock/utils';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { http } from 'msw';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createMockServer } from '@/mocks/node';
import type { MarketSession } from '@/shared/lib/marketSessionContext';
import { initialTrailingSheetState, useTrailingSheetStore } from '@/shared/lib/trailingSheetStore';
import { createTestQuoteStore } from '@/test/quotes';
import { renderWithProviders } from '@/test/renderWithProviders';
import { installResizeObserver } from '@/test/resizeObserver';
import { resetSession } from '@/test/session';
import { loginOnMock } from '@/test/watchlists';
import { TrailingStopSheetHost } from './TrailingStopSheetHost';

/** Monday 28 Sep 2026, 10:00 IST: NSE is open. */
const OPEN_MS = fromIst(2026, 9, 28, 10 * 60).getTime();
const HEAVY = 20_000;

let mobileSeq = 0;
const nextMobile = () => `98155${String(10_000 + (mobileSeq += 1)).slice(-5)}`;

const mock = createMockServer({
  clock: fixedClock(OPEN_MS),
  tickIntervalMs: 1_000_000_000,
  auth: { now: () => OPEN_MS },
});
const session: MarketSession = { clock: fixedClock(OPEN_MS), alwaysOpen: false };

async function infyToken(): Promise<number> {
  const quote = await mock.adapter.getQuote('INFY');
  if (!quote) throw new Error('no INFY');
  return quote.token;
}

/** Signs in, buys `qty` INFY (none for 0) and mounts the sheet host on a live trading store. */
async function renderSheet(qty: number) {
  const api = await loginOnMock(nextMobile(), 'http://sheet.test');
  const token = await infyToken();
  if (qty > 0) {
    await api.request('orderPlace', {
      body: { token, side: 'BUY', type: 'MARKET', product: 'DELIVERY', qty },
    });
  }
  const tradingStore = createTradingStore({
    loadState: () => api.request('accountState'),
    schedule: (flush) => queueMicrotask(flush),
  });
  await tradingStore.start();
  renderWithProviders(<TrailingStopSheetHost />, {
    apiClient: api,
    quoteStore: createTestQuoteStore().store,
    marketSession: session,
    tradingStore,
  });
  return { api, token };
}

async function openSheet(token: number) {
  act(() => {
    useTrailingSheetStore.getState().openSheet({ symbol: 'INFY', exchange: 'NSE', token });
  });
  return screen.findByRole('dialog', { name: 'Trailing stop · INFY' });
}

const stopsOf = async (api: ApiClient) =>
  (await api.request('trailingStopsList', {})).items.map((stop) => ({
    status: stop.status,
    trail: stop.trail,
  }));

beforeAll(() => mock.server.listen({ onUnhandledFrame: 'error' }));
beforeEach(() => {
  installResizeObserver();
});
let releaseQuotes = () => {};
afterEach(() => {
  releaseQuotes();
  mock.server.resetHandlers();
  resetSession();
  useTrailingSheetStore.setState(initialTrailingSheetState);
});
afterAll(() => {
  mock.server.close();
  mock.orders.dispose();
  mock.adapter.dispose();
});

describe('trailing-stop sheet (T18, SPEC-TFC-1 §8.4)', () => {
  it(
    'sets a 1.0% stop by default, updates the trail, then cancels it',
    async () => {
      const { api, token } = await renderSheet(10);

      // Set: the position with its P&L, no stop yet, a 1.00% trail ready to go.
      let sheet = await openSheet(token);
      expect(await within(sheet).findByTestId('sheet-position')).toHaveTextContent('+10 @ ₹');
      expect(within(sheet).getByTestId('sheet-status')).toHaveTextContent('No trailing stop');
      expect(await within(sheet).findByRole('textbox', { name: 'Trail (%)' })).toHaveValue('1.00');
      expect(within(sheet).queryByRole('textbox', { name: /Activation price/ })).toBeNull();
      fireEvent.click(within(sheet).getByRole('button', { name: 'Set trailing stop' }));
      expect(await screen.findByText('Trailing stop set')).toBeInTheDocument();
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      expect(await stopsOf(api)).toEqual([
        { status: 'TRAILING', trail: { unit: 'PERCENT', basisPoints: 100 } },
      ]);

      // Update: its own trail, nothing to send until it changes.
      sheet = await openSheet(token);
      expect(await within(sheet).findByTestId('sheet-status')).toHaveTextContent(
        /^Trailing · stop ₹/,
      );
      const update = within(sheet).getByRole('button', { name: 'Update trailing stop' });
      expect(update).toBeDisabled();
      fireEvent.change(within(sheet).getByRole('textbox', { name: 'Trail (%)' }), {
        target: { value: '1.5' },
      });
      await waitFor(() => expect(update).toBeEnabled());
      fireEvent.click(update);
      expect(await screen.findByText('Now trails by 1.5%.')).toBeInTheDocument();
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      expect(await stopsOf(api)).toEqual([
        { status: 'TRAILING', trail: { unit: 'PERCENT', basisPoints: 150 } },
      ]);

      // Cancel.
      sheet = await openSheet(token);
      fireEvent.click(await within(sheet).findByRole('button', { name: 'Cancel trailing stop' }));
      expect(await screen.findByText('Trailing stop cancelled')).toBeInTheDocument();
      expect((await stopsOf(api))[0]?.status).toBe('CANCELLED');
    },
    HEAVY,
  );

  it(
    'switching to rupees starts from 1% of the price',
    async () => {
      const { token } = await renderSheet(5);
      const sheet = await openSheet(token);
      const ltp = (await mock.adapter.getQuote('INFY'))?.ltp ?? 0;
      fireEvent.click(await within(sheet).findByRole('radio', { name: '₹' }));
      const expected = Math.max(5, Math.round(ltp / 100 / 5) * 5);
      const field = await within(sheet).findByRole('textbox', { name: 'Trail (₹)' });
      await waitFor(() => expect(field).toHaveValue((expected / 100).toFixed(2)));
    },
    HEAVY,
  );

  /** Holds the REST quote snapshot back (the test quote store never ticks) until `release()`. */
  function holdQuotes() {
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    mock.server.use(
      http.get('*/v1/market/quotes', async () => {
        await held;
        return undefined;
      }),
    );
    releaseQuotes = release;
    return release;
  }

  it(
    'switching to rupees before the first price fills the field once the price lands',
    async () => {
      const release = holdQuotes();
      const { token } = await renderSheet(5);
      const sheet = await openSheet(token);
      fireEvent.click(await within(sheet).findByRole('radio', { name: '₹' }));
      const field = await within(sheet).findByRole('textbox', { name: 'Trail (₹)' });
      expect(field).toHaveValue('');

      release();
      // 1% of INFY's seeded mock price, rounded to the 5-paise tick.
      await waitFor(() => expect(field).toHaveValue('15.25'));
    },
    HEAVY,
  );

  it(
    'a trail typed while the price is pending is kept when the price lands',
    async () => {
      const release = holdQuotes();
      const { token } = await renderSheet(5);
      const sheet = await openSheet(token);
      fireEvent.click(await within(sheet).findByRole('radio', { name: '₹' }));
      const field = await within(sheet).findByRole('textbox', { name: 'Trail (₹)' });
      fireEvent.change(field, { target: { value: '9' } });

      release();
      expect(await within(sheet).findByText(/^Initial stop /)).toBeInTheDocument();
      expect(field).toHaveValue('9');
    },
    HEAVY,
  );

  it(
    'with no position, says to open one first',
    async () => {
      const { token } = await renderSheet(0);
      const sheet = await openSheet(token);
      expect(
        await within(sheet).findByText(
          'Open a position first. A trailing stop protects an existing position.',
        ),
      ).toBeInTheDocument();
    },
    HEAVY,
  );
});
