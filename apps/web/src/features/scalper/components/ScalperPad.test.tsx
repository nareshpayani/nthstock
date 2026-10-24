import { createTradingStore, type TradingSource } from '@nthstock/apiClient';
import {
  WS_PROTOCOL_VERSION,
  type Depth,
  type Instrument,
  type Position,
  type WsAccountDelta,
} from '@nthstock/contracts';
import { fixedClock, formatInr, fromIst } from '@nthstock/utils';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockServer } from '@/mocks/node';
import { resetFillToasts } from '@/shared/lib/fillToasts';
import type { MarketSession } from '@/shared/lib/marketSessionContext';
import { createTestQuoteStore } from '@/test/quotes';
import { renderWithProviders } from '@/test/renderWithProviders';
import { resetSession } from '@/test/session';
import { loginOnMock } from '@/test/watchlists';
import { IDLE_DISARM_MS } from '../hooks/useArming';
import { resetScalperPrefs, useScalperPrefs } from '../model/scalperPrefs';
import { HOLD_MS } from './HoldButton';
import { ScalperPad } from './ScalperPad';

/** Monday 28 Sep 2026, 10:00 IST: NSE is open. */
const OPEN_MS = fromIst(2026, 9, 28, 10 * 60).getTime();
const HEAVY = 20_000;

let mobileSeq = 0;
const nextMobile = () => `98166${String(10_000 + (mobileSeq += 1)).slice(-5)}`;

const mock = createMockServer({
  clock: fixedClock(OPEN_MS),
  tickIntervalMs: 1_000_000_000,
  auth: { now: () => OPEN_MS },
});
const session: MarketSession = { clock: fixedClock(OPEN_MS), alwaysOpen: false };

/** A trading store on the mock's account, fed frames by hand: here, the depth on screen. */
async function renderPad() {
  const api = await loginOnMock(nextMobile(), 'http://scalper.test');
  const quote = await mock.adapter.getQuote('INFY');
  const depth = await mock.adapter.getDepth('INFY');
  if (!quote || !depth) throw new Error('no INFY');
  const listeners = new Set<(delta: WsAccountDelta) => void>();
  const source: TradingSource = {
    onAccountDelta: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    focus: () => undefined,
  };
  const tradingStore = createTradingStore({
    source,
    loadState: () => api.request('accountState'),
    schedule: (flush) => queueMicrotask(flush),
  });
  await tradingStore.start();
  const instrument: Instrument = {
    token: quote.token,
    symbol: 'INFY',
    exchange: 'NSE',
    name: 'Infosys Ltd',
    type: 'EQUITY',
    isin: 'INE009A01021',
    sector: 'Information Technology',
    lotSize: 1,
    tickSize: 5,
  };
  renderWithProviders(<ScalperPad instrument={instrument} />, {
    apiClient: api,
    quoteStore: createTestQuoteStore().store,
    marketSession: session,
    tradingStore,
  });
  const frame = (next: Depth, positions: Position[] = []) => {
    const delta: WsAccountDelta = {
      v: WS_PROTOCOL_VERSION,
      type: 'accountDelta',
      seq: tradingStore.getState().seq,
      at: new Date(OPEN_MS).toISOString(),
      quotes: [],
      depth: next,
      orders: [],
      positions,
      trailingStops: [],
    };
    act(() => {
      for (const listener of listeners) listener(delta);
    });
  };
  // The pad focuses INFY on mount; the next frame carries its depth.
  const pad = await screen.findByRole('region', { name: 'Scalper for INFY' });
  frame(depth);
  await waitFor(() =>
    expect(within(pad).getByTestId('scalp-buy')).not.toHaveTextContent('Waiting'),
  );
  /** Brings the engine's positions on screen, as the next frame would. */
  const syncPositions = async () => {
    const state = await api.request('accountState');
    frame(depth, state.positions);
  };
  /** Buys `qty` INFY intraday at market and shows the position on the pad. */
  const holdLong = async (qty: number) => {
    await api.request('orderPlace', {
      body: { token: quote.token, side: 'BUY', type: 'MARKET', product: 'INTRADAY', qty },
    });
    await syncPositions();
    await waitFor(() =>
      expect(
        tradingStore.getState().positions.find((position) => position.token === quote.token)
          ?.netQty,
      ).toBe(qty),
    );
  };
  const netQty = async () =>
    (await api.request('accountState')).positions.find(
      (position) => position.token === quote.token && position.product === 'INTRADAY',
    )?.netQty ?? 0;
  return { api, depth, frame, pad, holdLong, netQty, syncPositions };
}

const setVisibility = (state: DocumentVisibilityState) => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
  document.dispatchEvent(new Event('visibilitychange'));
};

const ordersOf = async (api: Awaited<ReturnType<typeof loginOnMock>>) =>
  (await api.request('ordersList', {})).items;

beforeAll(() => mock.server.listen({ onUnhandledFrame: 'error' }));
beforeEach(() => {
  resetScalperPrefs();
  resetFillToasts();
});
afterEach(() => {
  mock.server.resetHandlers();
  vi.useRealTimers();
  setVisibility('visible');
  resetSession();
});
afterAll(() => {
  mock.server.close();
  mock.orders.dispose();
  mock.adapter.dispose();
});

describe('scalper pad (T21, SPEC-TFC-1 §11)', () => {
  it(
    'disarmed, the buttons say "Arm to trade" and send nothing',
    async () => {
      const { api, pad } = await renderPad();
      const buy = within(pad).getByTestId('scalp-buy');
      expect(buy).toHaveAccessibleName(/^Buy at ask Arm to trade$/);
      expect(buy).toHaveAttribute('aria-disabled', 'true');
      fireEvent.click(buy);
      fireEvent.click(within(pad).getByTestId('scalp-sell'));
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(await ordersOf(api)).toEqual([]);
      expect(within(pad).getByTestId('scalp-ack')).toHaveTextContent('');
    },
    HEAVY,
  );

  it(
    'armed, Buy at ask sends one IOC limit at the ask and acknowledges the fill',
    async () => {
      const { api, depth, pad } = await renderPad();
      fireEvent.click(within(pad).getByRole('radio', { name: '10 shares' }));
      fireEvent.click(within(pad).getByRole('switch', { name: 'Arm' }));
      const ask = depth.asks[0]?.price ?? 0;
      const buy = within(pad).getByTestId('scalp-buy');
      expect(buy).toHaveAccessibleName(
        `Buy at ask ₹${(ask / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`,
      );
      expect(buy).toHaveAccessibleDescription(/^Buys 10 INFY intraday/);
      fireEvent.click(buy);
      expect(within(pad).getByTestId('scalp-ack')).toHaveTextContent('Buying 10…');
      await waitFor(() =>
        expect(within(pad).getByTestId('scalp-ack')).toHaveTextContent(/^Bought 10 @ ₹/),
      );
      expect(await screen.findByText('Scalp filled')).toBeInTheDocument();
      const [order] = await ordersOf(api);
      expect(order).toMatchObject({
        side: 'BUY',
        type: 'LIMIT',
        product: 'INTRADAY',
        validity: 'IOC',
        qty: 10,
        price: ask,
        status: 'EXECUTED',
      });
    },
    HEAVY,
  );

  it(
    'a buy the market will not take is cancelled unfilled, and the pad says so',
    async () => {
      const { depth, frame, pad } = await renderPad();
      // An ask 10% under the LTP: a buy limit there is not marketable, so the IOC cancels it.
      const low = Math.round(((depth.bids[0]?.price ?? 0) * 0.9) / 5) * 5;
      frame({ ...depth, asks: depth.asks.map((level, i) => ({ ...level, price: low + i * 5 })) });
      fireEvent.click(within(pad).getByRole('switch', { name: 'Arm' }));
      const buy = within(pad).getByTestId('scalp-buy');
      await waitFor(() => expect(buy).toHaveTextContent(formatInr(low)));
      fireEvent.click(buy);
      await waitFor(() =>
        expect(within(pad).getByTestId('scalp-ack')).toHaveAttribute('data-tone', 'unfilled'),
      );
      expect(within(pad).getByTestId('scalp-ack')).toHaveTextContent('Not filled');
      expect(await screen.findByText('Scalp not filled')).toBeInTheDocument();
    },
    HEAVY,
  );

  it(
    'remembers the custom size on the device',
    async () => {
      const { pad } = await renderPad();
      fireEvent.change(within(pad).getByRole('textbox', { name: 'Custom quantity' }), {
        target: { value: '40' },
      });
      expect(useScalperPrefs.getState()).toMatchObject({ qty: 40, customQty: 40 });
      expect(JSON.parse(window.localStorage.getItem('nthstock.scalper.v1') ?? '{}')).toEqual({
        qty: 40,
        customQty: 40,
      });
      fireEvent.click(within(pad).getByRole('switch', { name: 'Arm' }));
      expect(within(pad).getByTestId('scalp-buy')).toHaveAccessibleDescription(/^Buys 40 INFY/);
    },
    HEAVY,
  );
});

describe('flatten, reverse and arming safety (T22, SPEC-TFC-1 §11.2, §11.3)', () => {
  it(
    'disarmed, Flatten and a held Reverse send nothing, even with a position open',
    async () => {
      const { api, pad, holdLong } = await renderPad();
      await holdLong(5);
      const before = (await ordersOf(api)).length;
      const flatten = within(pad).getByTestId('scalp-flatten');
      const reverse = within(pad).getByTestId('scalp-reverse');
      expect(flatten).toHaveTextContent('Arm to trade');
      expect(flatten).toHaveAttribute('aria-disabled', 'true');
      expect(reverse).toHaveAttribute('aria-disabled', 'true');
      fireEvent.click(flatten);
      fireEvent.pointerDown(reverse, { button: 0 });
      await new Promise((resolve) => setTimeout(resolve, HOLD_MS + 100));
      fireEvent.pointerUp(reverse);
      expect(await ordersOf(api)).toHaveLength(before);
    },
    HEAVY,
  );

  it(
    'armed, Flatten closes the whole position in one tap',
    async () => {
      const { api, pad, holdLong, netQty } = await renderPad();
      await holdLong(5);
      fireEvent.click(within(pad).getByRole('switch', { name: 'Arm' }));
      const flatten = within(pad).getByTestId('scalp-flatten');
      expect(flatten).toHaveAccessibleName('Flatten Sell 5');
      expect(flatten).toHaveAccessibleDescription(/^Closes your whole intraday INFY position/);
      fireEvent.click(flatten);
      expect(within(pad).getByTestId('scalp-ack')).toHaveTextContent('Closing position…');
      await waitFor(() =>
        expect(within(pad).getByTestId('scalp-ack')).toHaveTextContent(/^Closed: sold 5 @ ₹/),
      );
      expect(await screen.findByText('Position closed')).toBeInTheDocument();
      expect(await netQty()).toBe(0);
      const [exit] = await ordersOf(api);
      expect(exit).toMatchObject({ side: 'SELL', type: 'MARKET', qty: 5, status: 'EXECUTED' });
    },
    HEAVY,
  );

  it(
    'Reverse needs the 400 ms hold: a tap or a short press sends nothing; the hold closes and opens the other way',
    async () => {
      const { api, pad, holdLong, netQty } = await renderPad();
      await holdLong(5);
      fireEvent.click(within(pad).getByRole('switch', { name: 'Arm' }));
      const reverse = within(pad).getByTestId('scalp-reverse');
      expect(reverse).toHaveTextContent('Hold to reverse');
      const before = (await ordersOf(api)).length;
      fireEvent.click(reverse);
      fireEvent.pointerDown(reverse, { button: 0 });
      await new Promise((resolve) => setTimeout(resolve, HOLD_MS / 2));
      fireEvent.pointerUp(reverse);
      await new Promise((resolve) => setTimeout(resolve, HOLD_MS));
      expect(await ordersOf(api)).toHaveLength(before);

      fireEvent.pointerDown(reverse, { button: 0 });
      await waitFor(
        () =>
          expect(within(pad).getByTestId('scalp-ack')).toHaveTextContent(/^Reversed: Sold 5 @ ₹/),
        { timeout: 3_000 },
      );
      fireEvent.pointerUp(reverse);
      expect(await netQty()).toBe(-5);
      const [entry, exit] = await ordersOf(api);
      expect(exit).toMatchObject({ side: 'SELL', type: 'MARKET', qty: 5, status: 'EXECUTED' });
      expect(entry).toMatchObject({
        side: 'SELL',
        type: 'LIMIT',
        product: 'INTRADAY',
        validity: 'IOC',
        qty: 5,
        status: 'EXECUTED',
      });
    },
    HEAVY,
  );

  it(
    'a Reverse whose close only partly fills stops there and says how much is left',
    async () => {
      const { api, pad, holdLong } = await renderPad();
      await holdLong(5);
      const [buy] = await ordersOf(api);
      if (!buy) throw new Error('no buy');
      mock.server.use(
        http.post('http://scalper.test/v1/positions/close', () =>
          HttpResponse.json({
            ...buy,
            id: 'ord_part_close',
            clientOrderId: null,
            side: 'SELL',
            type: 'MARKET',
            price: null,
            validity: 'DAY',
            filledQty: 2,
            status: 'CANCELLED',
          }),
        ),
      );
      fireEvent.click(within(pad).getByRole('switch', { name: 'Arm' }));
      const reverse = within(pad).getByTestId('scalp-reverse');
      fireEvent.pointerDown(reverse, { button: 0 });
      await waitFor(
        () =>
          expect(within(pad).getByTestId('scalp-ack')).toHaveTextContent('Partly closed: 3 left'),
        { timeout: 3_000 },
      );
      fireEvent.pointerUp(reverse);
      await new Promise((resolve) => setTimeout(resolve, 100));
      // No entry the other way: the only order is still the buy.
      expect(await ordersOf(api)).toHaveLength(1);
    },
    HEAVY,
  );

  it(
    'keyboard users reverse by holding Enter',
    async () => {
      const { pad, holdLong, netQty } = await renderPad();
      await holdLong(3);
      fireEvent.click(within(pad).getByRole('switch', { name: 'Arm' }));
      const reverse = within(pad).getByTestId('scalp-reverse');
      reverse.focus();
      fireEvent.keyDown(reverse, { key: 'Enter' });
      await waitFor(
        () => expect(within(pad).getByTestId('scalp-ack')).toHaveTextContent(/^Reversed: Sold 3/),
        { timeout: 3_000 },
      );
      fireEvent.keyUp(reverse, { key: 'Enter' });
      expect(await netQty()).toBe(-3);
    },
    HEAVY,
  );

  it(
    'disarms after 2 minutes without a trade and says so; then a tap sends nothing',
    async () => {
      const { api, pad } = await renderPad();
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      fireEvent.click(within(pad).getByRole('switch', { name: 'Arm' }));
      expect(within(pad).getByRole('switch', { name: 'Arm' })).toHaveAttribute(
        'aria-checked',
        'true',
      );
      act(() => vi.advanceTimersByTime(IDLE_DISARM_MS - 1));
      expect(within(pad).getByTestId('scalp-buy')).not.toHaveTextContent('Arm to trade');
      act(() => vi.advanceTimersByTime(1));
      expect(within(pad).getByRole('switch', { name: 'Arm' })).toHaveAttribute(
        'aria-checked',
        'false',
      );
      expect(within(pad).getByTestId('scalp-ack')).toHaveTextContent(
        'Disarmed: 2 minutes without a trade.',
      );
      vi.useRealTimers();
      fireEvent.click(within(pad).getByTestId('scalp-buy'));
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(await ordersOf(api)).toEqual([]);
    },
    HEAVY,
  );

  it(
    'disarms when the page is hidden',
    async () => {
      const { api, pad } = await renderPad();
      fireEvent.click(within(pad).getByRole('switch', { name: 'Arm' }));
      act(() => setVisibility('hidden'));
      act(() => setVisibility('visible'));
      expect(within(pad).getByRole('switch', { name: 'Arm' })).toHaveAttribute(
        'aria-checked',
        'false',
      );
      expect(within(pad).getByTestId('scalp-ack')).toHaveTextContent(
        'Disarmed: you left the page.',
      );
      fireEvent.click(within(pad).getByTestId('scalp-sell'));
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(await ordersOf(api)).toEqual([]);
    },
    HEAVY,
  );
});
