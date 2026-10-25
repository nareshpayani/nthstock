import { createTradingStore, type ApiClient } from '@nthstock/apiClient';
import { fixedClock, fromIst } from '@nthstock/utils';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createMockServer } from '@/mocks/node';
import type { MarketSession } from '@/shared/lib/marketSessionContext';
import {
  initialPositionEditorState,
  usePositionEditorStore,
  type PositionEditorTab,
} from '@/shared/lib/positionEditorStore';
import { initialTicketIntentState, useTicketIntentStore } from '@/shared/lib/ticketIntentStore';
import { createTestQuoteStore } from '@/test/quotes';
import { renderWithProviders } from '@/test/renderWithProviders';
import { installResizeObserver } from '@/test/resizeObserver';
import { resetSession } from '@/test/session';
import { loginOnMock } from '@/test/watchlists';
import { PositionEditorHost } from './PositionEditorHost';

/** Monday 28 Sep 2026, 10:00 IST: NSE is open. */
const OPEN_MS = fromIst(2026, 9, 28, 10 * 60).getTime();
const HEAVY = 20_000;

let mobileSeq = 0;
const nextMobile = () => `98156${String(10_000 + (mobileSeq += 1)).slice(-5)}`;

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

/** Signs in, buys `qty` INFY for delivery and mounts the editor host on a live trading store. */
async function renderEditor(qty: number) {
  const api = await loginOnMock(nextMobile(), 'http://editor.test');
  const token = await infyToken();
  await api.request('orderPlace', {
    body: { token, side: 'BUY', type: 'MARKET', product: 'DELIVERY', qty },
  });
  const tradingStore = createTradingStore({
    loadState: () => api.request('accountState'),
    schedule: (flush) => queueMicrotask(flush),
  });
  await tradingStore.start();
  renderWithProviders(<PositionEditorHost />, {
    apiClient: api,
    quoteStore: createTestQuoteStore().store,
    marketSession: session,
    tradingStore,
  });
  return { api, token, tradingStore };
}

async function openEditor(token: number, tab?: PositionEditorTab) {
  act(() => {
    usePositionEditorStore.getState().openEditor({
      symbol: 'INFY',
      exchange: 'NSE',
      token,
      product: 'DELIVERY',
      ...(tab ? { tab } : {}),
    });
  });
  return screen.findByRole('dialog', { name: 'Edit INFY · Delivery' });
}

const stopsOf = async (api: ApiClient) => (await api.request('trailingStopsList', {})).items;
const heldQty = async (api: ApiClient) =>
  (await api.request('positionsList', {})).items.find((p) => p.product === 'DELIVERY')?.netQty;

beforeAll(() => mock.server.listen({ onUnhandledFrame: 'error' }));
beforeEach(() => {
  installResizeObserver();
});
afterEach(() => {
  mock.server.resetHandlers();
  resetSession();
  usePositionEditorStore.setState(initialPositionEditorState);
  useTicketIntentStore.setState(initialTicketIntentState);
});
afterAll(() => {
  mock.server.close();
  mock.orders.dispose();
  mock.adapter.dispose();
});

describe('position editor (NSTOCK-0395)', () => {
  it(
    'states the executed quantity, then sets and changes every trailing-stop term',
    async () => {
      const { api, token } = await renderEditor(10);

      // Set, with a limit exit: every term is offered, not only the trail.
      let editor = await openEditor(token);
      const summary = await within(editor).findByTestId('editor-summary');
      expect(summary).toHaveTextContent('Executed qty+10');
      expect(within(summary).getByTestId('editor-stop')).toHaveTextContent('No trailing stop');
      expect(
        await within(editor).findByRole('textbox', { name: /Activation price/ }),
      ).toBeInTheDocument();
      const exitType = within(editor).getByRole('radiogroup', { name: 'Exit order' });
      fireEvent.click(within(exitType).getByRole('radio', { name: 'Limit' }));
      fireEvent.change(within(editor).getByRole('textbox', { name: 'Limit offset (₹)' }), {
        target: { value: '0.5' },
      });
      fireEvent.click(within(editor).getByRole('button', { name: 'Set trailing stop' }));
      expect(await screen.findByText('Trailing stop set')).toBeInTheDocument();
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      let [stop] = await stopsOf(api);
      expect(stop).toMatchObject({
        status: 'TRAILING',
        exitOrderType: 'LIMIT',
        exitLimitOffset: 50,
      });

      // Update the exit type alone: back to market.
      editor = await openEditor(token);
      expect(await within(editor).findByTestId('editor-stop')).toHaveTextContent(
        /^Trailing · stop ₹.* · protects 10 qty$/,
      );
      const update = within(editor).getByRole('button', { name: 'Update trailing stop' });
      expect(update).toBeDisabled();
      fireEvent.click(
        within(within(editor).getByRole('radiogroup', { name: 'Exit order' })).getByRole('radio', {
          name: 'Market',
        }),
      );
      await waitFor(() => expect(update).toBeEnabled());
      fireEvent.click(update);
      expect(await screen.findByText('Trailing stop updated')).toBeInTheDocument();
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      [stop] = await stopsOf(api);
      expect(stop).toMatchObject({ exitOrderType: 'MARKET', exitLimitOffset: null });

      // Move the stop to a typed price, as a drag of its line does.
      const target = (stop?.stopPrice ?? 0) - 500;
      editor = await openEditor(token);
      const move = await within(editor).findByTestId('editor-move-stop');
      fireEvent.change(within(move).getByRole('textbox', { name: 'Move stop to (₹)' }), {
        target: { value: (target / 100).toFixed(2) },
      });
      fireEvent.click(within(move).getByRole('button', { name: 'Move stop' }));
      expect(await screen.findByText('Stop moved')).toBeInTheDocument();
      [stop] = await stopsOf(api);
      expect(stop?.stopPrice).toBe(target);
    },
    HEAVY,
  );

  it(
    'exits part of the position, and refuses more than is held',
    async () => {
      const { api, token } = await renderEditor(10);
      const editor = await openEditor(token, 'exit');
      const qty = await within(editor).findByRole('textbox', { name: 'Quantity' });
      expect(qty).toHaveValue('10');
      expect(within(editor).getByRole('radio', { name: 'Sell' })).toHaveAttribute(
        'aria-checked',
        'true',
      );

      fireEvent.change(qty, { target: { value: '11' } });
      fireEvent.click(within(editor).getByRole('button', { name: 'Sell INFY' }));
      expect(
        await within(editor).findByText('You hold 10. Exit up to 10, or use Add to trade more.'),
      ).toBeInTheDocument();

      fireEvent.change(qty, { target: { value: '4' } });
      fireEvent.click(within(editor).getByRole('button', { name: 'Sell INFY' }));
      fireEvent.click(await within(editor).findByRole('button', { name: 'Confirm' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      await waitFor(async () => expect(await heldQty(api)).toBe(6));
    },
    HEAVY,
  );

  it(
    'lists open orders in the stock with their filled quantity, and cancels one',
    async () => {
      const { api, token, tradingStore } = await renderEditor(5);
      const ltp = (await mock.adapter.getQuote('INFY'))?.ltp ?? 0;
      const far = Math.round((ltp * 0.9) / 5) * 5;
      await api.request('orderPlace', {
        body: { token, side: 'BUY', type: 'LIMIT', product: 'DELIVERY', qty: 3, price: far },
      });
      await tradingStore.start();
      const editor = await openEditor(token);
      const orders = await within(editor).findByRole('region', {
        name: 'Open orders in this stock',
      });
      expect(orders).toHaveTextContent(/Buy Limit ₹.* · filled 0 of 3/);

      const cancel = within(orders).getByRole('button', { name: /^Cancel Buy Limit/ });
      fireEvent.click(cancel);
      expect(cancel).toHaveTextContent('Confirm cancel');
      fireEvent.click(cancel);
      expect(await screen.findByText('Order cancelled')).toBeInTheDocument();
      const book = await api.request('ordersList', {});
      expect(book.items.find((order) => order.type === 'LIMIT')?.status).toBe('CANCELLED');
    },
    HEAVY,
  );
});
