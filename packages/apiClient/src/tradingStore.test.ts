import type {
  AccountState,
  Depth,
  FundsSummary,
  Order,
  Position,
  TrailingStop,
  WsAccountDelta,
} from '@nthstock/contracts';
import { describe, expect, it, vi } from 'vitest';
import {
  createTradingStore,
  type TradingCommit,
  type TradingSource,
  type TradingStoreOptions,
} from './tradingStore.js';
import type { WsStatus } from './wsClient.js';

const TS = '2026-09-28T04:30:00.000Z';

const order = (id: string, seq: number, extra: Partial<Order> = {}): Order => ({
  id,
  clientOrderId: null,
  token: 8,
  symbol: 'INFY',
  exchange: 'NSE',
  side: 'BUY',
  type: 'LIMIT',
  product: 'INTRADAY',
  qty: 10,
  price: 150_000,
  filledQty: 0,
  avgFillPrice: null,
  status: 'OPEN',
  statusReason: null,
  validity: 'DAY',
  seq,
  placedAt: TS,
  updatedAt: TS,
  ...extra,
});

const stop = (id: string, seq: number, extra: Partial<TrailingStop> = {}): TrailingStop => ({
  id,
  token: 8,
  symbol: 'INFY',
  exchange: 'NSE',
  product: 'INTRADAY',
  direction: 'LONG',
  trail: { unit: 'AMOUNT', amount: 1_000 },
  activationPrice: null,
  exitOrderType: 'MARKET',
  exitLimitOffset: null,
  status: 'TRAILING',
  statusReason: null,
  watermarkPrice: 151_000,
  stopPrice: 150_000,
  protectedQty: 10,
  entryOrderId: null,
  exitOrderId: null,
  seq,
  createdAt: TS,
  updatedAt: TS,
  ...extra,
});

const position = (netQty: number, ltp = 150_000): Position => ({
  token: 8,
  symbol: 'INFY',
  exchange: 'NSE',
  product: 'INTRADAY',
  netQty,
  buyQty: Math.max(netQty, 0),
  sellQty: 0,
  avgBuyPrice: 150_000,
  avgSellPrice: 0,
  ltp,
  realisedPnl: 0,
  unrealisedPnl: (ltp - 150_000) * netQty,
});

const funds = (available: number): FundsSummary => ({
  openingBalance: 100_000_000,
  balance: 100_000_000,
  blocked: 100_000_000 - available,
  available,
  realisedPnlToday: 0,
  asOf: TS,
});

const depth = (symbol = 'INFY'): Depth => {
  const level = (price: number) => ({ price, qty: 10, orders: 1 });
  return {
    token: 8,
    symbol,
    exchange: 'NSE',
    bids: [level(149_995), level(149_990), level(149_985), level(149_980), level(149_975)],
    asks: [level(150_005), level(150_010), level(150_015), level(150_020), level(150_025)],
    totalBidQty: 50,
    totalAskQty: 50,
    ts: TS,
  };
};

const frame = (seq: number, extra: Partial<WsAccountDelta> = {}): WsAccountDelta => ({
  v: 1,
  type: 'accountDelta',
  seq,
  at: TS,
  quotes: [],
  orders: [],
  positions: [],
  trailingStops: [],
  ...extra,
});

const snapshot = (seq: number, extra: Partial<AccountState> = {}): AccountState => ({
  seq,
  orders: [],
  positions: [],
  trailingStops: [],
  funds: funds(100_000_000),
  ...extra,
});

/** A source the test drives, frames the test runs, timers the test fires, and a scripted load. */
function setup(states: AccountState[], options: Partial<TradingStoreOptions> = {}) {
  const frames: (() => void)[] = [];
  let emit: (delta: WsAccountDelta) => void = () => undefined;
  let setStatus: (status: WsStatus) => void = () => undefined;
  const focusCalls: (string | null)[] = [];
  const source: TradingSource = {
    onAccountDelta(listener) {
      emit = listener;
      return () => undefined;
    },
    focus(symbol) {
      focusCalls.push(symbol);
    },
    onStatus(listener) {
      setStatus = listener;
      return () => undefined;
    },
  };
  const timeouts = new Map<number, () => void>();
  let nextTimer = 0;
  const loads: { resolve: () => void; reject: () => void }[] = [];
  const loadState = vi.fn(
    () =>
      new Promise<AccountState>((resolve, reject) => {
        const next = states.shift() ?? snapshot(0);
        loads.push({ resolve: () => resolve(next), reject: () => reject(new Error('down')) });
      }),
  );
  const commits: TradingCommit[] = [];
  const quoteFlush = vi.fn();
  const store = createTradingStore({
    source,
    loadState,
    quoteStore: { flush: quoteFlush },
    schedule: (flush) => frames.push(flush),
    timers: {
      setTimeout: (callback) => {
        nextTimer += 1;
        timeouts.set(nextTimer, callback);
        return nextTimer;
      },
      clearTimeout: (handle) => {
        timeouts.delete(handle as number);
      },
    },
    now: () => 1_000,
    onCommit: (commit) => commits.push(commit),
    ...options,
  });
  const runFrame = () => {
    for (const flush of frames.splice(0)) flush();
  };
  /** Answers the oldest load in flight, then lets its promise chain settle. */
  const answerLoad = async (ok = true) => {
    const load = loads.shift();
    if (!load) throw new Error('no load in flight');
    if (ok) load.resolve();
    else load.reject();
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  };
  const fireTimeouts = () => {
    const callbacks = [...timeouts.values()];
    timeouts.clear();
    for (const callback of callbacks) callback();
  };
  return {
    store,
    emit: (delta: WsAccountDelta) => emit(delta),
    setStatus: (status: WsStatus) => setStatus(status),
    focusCalls,
    loadState,
    loads,
    answerLoad,
    runFrame,
    frames,
    commits,
    quoteFlush,
    timeouts,
    fireTimeouts,
  };
}

async function started(states: AccountState[], options: Partial<TradingStoreOptions> = {}) {
  const harness = setup(states, options);
  const done = harness.store.start();
  await harness.answerLoad();
  await done;
  harness.runFrame();
  return harness;
}

describe('trading store (T10, ADR 0012)', () => {
  it('loads the account state, then applies each frame in one commit on the next frame', async () => {
    const t = setup([snapshot(4, { orders: [order('o1', 4)], positions: [position(10)] })]);
    expect(t.store.getState().status).toBe('idle');
    const done = t.store.start();
    // `start` switches the socket to frames.
    expect(t.focusCalls).toEqual([null]);
    await t.answerLoad();
    await done;
    t.runFrame();
    expect(t.store.getState()).toMatchObject({ status: 'ready', seq: 4 });
    expect(t.store.getState().orders.map((o) => o.id)).toEqual(['o1']);

    const listener = vi.fn();
    t.store.subscribe(listener);
    const before = t.store.getState();
    t.emit(
      frame(5, {
        orders: [order('o1', 5, { status: 'EXECUTED', filledQty: 10, avgFillPrice: 150_000 })],
        positions: [position(10, 150_500)],
        funds: funds(98_500_000),
      }),
    );
    // Nothing is visible until the frame commits, and then everything at once.
    expect(t.store.getState()).toBe(before);
    expect(listener).not.toHaveBeenCalled();
    t.runFrame();
    expect(listener).toHaveBeenCalledTimes(1);
    const after = t.store.getState();
    expect(after.seq).toBe(5);
    expect(after.orders[0]?.status).toBe('EXECUTED');
    expect(after.positions[0]?.ltp).toBe(150_500);
    expect(after.funds?.available).toBe(98_500_000);
    // The quote store commits in the same frame.
    expect(t.quoteFlush).toHaveBeenCalled();
    expect(t.commits.at(-1)).toMatchObject({
      reloaded: false,
      positionsChanged: true,
      fundsChanged: true,
    });
    expect(t.commits.at(-1)?.orders.map((o) => o.id)).toEqual(['o1']);
  });

  it('drops a stale frame but keeps its depth, and applies a frame at its own seq', async () => {
    const t = await started([snapshot(10, { orders: [order('o1', 10)] })]);
    t.store.focus('INFY');
    t.emit(
      frame(8, {
        orders: [order('o1', 8, { status: 'CANCELLED' })],
        positions: [position(5)],
        depth: depth(),
      }),
    );
    t.runFrame();
    const state = t.store.getState();
    expect(state.orders[0]?.status).toBe('OPEN');
    expect(state.positions).toEqual([]);
    expect(state.seq).toBe(10);
    expect(state.depth?.symbol).toBe('INFY');
    expect(t.loadState).toHaveBeenCalledTimes(1);

    // A frame at the same seq carries no new change, only prices: positions move with them.
    t.emit(frame(10, { positions: [position(10, 150_400)] }));
    t.runFrame();
    expect(t.store.getState().positions[0]?.ltp).toBe(150_400);

    // Depth of another instrument than the focused one is ignored.
    t.emit(frame(10, { depth: depth('TCS') }));
    t.runFrame();
    expect(t.store.getState().depth?.symbol).toBe('INFY');
  });

  it('re-reads the account on a seq gap, holding frames meanwhile and applying newer ones', async () => {
    const t = await started([
      snapshot(3, { orders: [order('o1', 3)] }),
      snapshot(9, {
        orders: [order('o1', 9, { status: 'EXECUTED' }), order('o2', 7)],
        trailingStops: [stop('s1', 8)],
      }),
    ]);
    // Seq 9, but the frame carries no change at 9: something in between was lost.
    t.emit(frame(9, { orders: [order('o2', 7)] }));
    expect(t.loadState).toHaveBeenCalledTimes(2);
    // Frames during the re-read wait for it: one the snapshot covers, one after it.
    t.emit(frame(9, { trailingStops: [stop('s1', 9)] }));
    t.emit(frame(10, { trailingStops: [stop('s1', 10, { stopPrice: 150_500 })] }));
    t.runFrame();
    expect(t.store.getState().seq).toBe(3);

    await t.answerLoad();
    t.runFrame();
    const state = t.store.getState();
    expect(state.seq).toBe(10);
    expect(state.orders.map((o) => [o.id, o.status])).toEqual([
      ['o2', 'OPEN'],
      ['o1', 'EXECUTED'],
    ]);
    expect(state.trailingStops[0]).toMatchObject({ seq: 10, stopPrice: 150_500 });
    expect(t.commits.some((c) => c.reloaded)).toBe(true);
  });

  it('re-reads when the socket reopens after a drop', async () => {
    const t = await started([snapshot(2), snapshot(6)]);
    t.setStatus('open');
    expect(t.loadState).toHaveBeenCalledTimes(1);
    t.setStatus('reconnecting');
    t.setStatus('open');
    expect(t.loadState).toHaveBeenCalledTimes(2);
    await t.answerLoad();
    t.runFrame();
    expect(t.store.getState().seq).toBe(6);
  });

  it('never lets an older copy of an order or stop replace a newer one', async () => {
    const t = await started([snapshot(5, { orders: [order('o1', 5)] })]);
    // A command response that raced ahead of its frame.
    t.store.applyOrder(order('o1', 7, { price: 151_000 }));
    t.emit(frame(6, { orders: [order('o1', 6, { price: 150_500 })] }));
    t.runFrame();
    expect(t.store.getState().orders[0]).toMatchObject({ seq: 7, price: 151_000 });
    expect(t.store.getState().seq).toBe(6);
    t.store.applyTrailingStop(stop('s1', 9, { stopPrice: 150_600 }));
    t.emit(frame(8, { trailingStops: [stop('s1', 8)] }));
    t.runFrame();
    expect(t.store.getState().trailingStops[0]).toMatchObject({ seq: 9, stopPrice: 150_600 });
  });

  it('shows a pending intent until its response acknowledges it', async () => {
    const t = await started([snapshot(1, { orders: [order('o1', 1)] })]);
    const drag = t.store.begin({ kind: 'modify', orderId: 'o1', price: 149_500 });
    t.runFrame();
    expect(t.store.getState().pending).toEqual([
      expect.objectContaining({ kind: 'modify', orderId: 'o1', price: 149_500, startedAt: 1_000 }),
    ]);
    drag.ack(order('o1', 2, { price: 149_500 }));
    t.runFrame();
    expect(t.store.getState().pending).toEqual([]);
    expect(t.store.getState().orders[0]?.price).toBe(149_500);
    expect(t.timeouts.size).toBe(0);
  });

  it('settles a placement on the frame that carries its order, before the response', async () => {
    const t = await started([snapshot(1)]);
    const placing = t.store.begin({ kind: 'place', clientOrderId: 'c_42' });
    t.emit(frame(2, { orders: [order('o9', 2, { clientOrderId: 'c_42' })] }));
    t.runFrame();
    expect(t.store.getState().pending).toEqual([]);
    expect(t.store.getState().orders.map((o) => o.id)).toEqual(['o9']);
    placing.ack(order('o9', 2, { clientOrderId: 'c_42' }));
    expect(t.store.getState().orders).toHaveLength(1);
  });

  it('drops a pending intent on rejection, and a modify a fill made moot', async () => {
    const t = await started([snapshot(1, { orders: [order('o1', 1)] })]);
    const refused = t.store.begin({ kind: 'cancel', orderId: 'o1' });
    refused.fail();
    t.runFrame();
    expect(t.store.getState().pending).toEqual([]);
    expect(t.store.getState().orders[0]?.status).toBe('OPEN');

    t.store.begin({ kind: 'modify', orderId: 'o1', price: 149_000 });
    t.emit(frame(2, { orders: [order('o1', 2, { status: 'EXECUTED', filledQty: 10 })] }));
    t.runFrame();
    expect(t.store.getState().pending).toEqual([]);
  });

  it('times a pending intent out after 5 s: drops it, tells the caller and re-reads', async () => {
    const onIntentTimeout = vi.fn();
    const t = await started([snapshot(1), snapshot(3, { orders: [order('o1', 3)] })]);
    t.store.onIntentTimeout(onIntentTimeout);
    const handle = t.store.begin({ kind: 'placeTrailingStop' });
    t.fireTimeouts();
    expect(onIntentTimeout).toHaveBeenCalledWith(expect.objectContaining({ key: handle.key }));
    expect(t.loadState).toHaveBeenCalledTimes(2);
    await t.answerLoad();
    t.runFrame();
    expect(t.store.getState()).toMatchObject({ pending: [], seq: 3 });
    // A late answer after the timeout changes nothing it should not.
    handle.ack(stop('s1', 2));
    t.runFrame();
    expect(t.store.getState().trailingStops.map((s) => s.id)).toEqual(['s1']);
  });

  it('forgets everything on sign-out and ignores frames and a late load until started again', async () => {
    const t = setup([snapshot(5, { orders: [order('o1', 5)] }), snapshot(1)]);
    const first = t.store.start();
    t.store.begin({ kind: 'place', clientOrderId: 'c_1' });
    t.store.clear();
    await t.answerLoad();
    await first;
    t.emit(frame(6, { orders: [order('o2', 6)] }));
    t.runFrame();
    expect(t.store.getState()).toMatchObject({
      status: 'idle',
      seq: 0,
      orders: [],
      pending: [],
      funds: null,
    });
    expect(t.timeouts.size).toBe(0);
    expect(t.commits.at(-1)?.reloaded).toBe(true);

    const again = t.store.start();
    await t.answerLoad();
    await again;
    t.runFrame();
    expect(t.store.getState()).toMatchObject({ status: 'ready', seq: 1, orders: [] });
  });

  it('reports a first load that fails, and recovers on the next start', async () => {
    const t = setup([snapshot(1), snapshot(2)]);
    const first = t.store.start();
    await t.answerLoad(false);
    await first;
    t.runFrame();
    expect(t.store.getState().status).toBe('error');
    const again = t.store.start();
    await t.answerLoad();
    await again;
    t.runFrame();
    expect(t.store.getState()).toMatchObject({ status: 'ready', seq: 2 });
  });

  it('sends focus to the source and clears the depth when the instrument changes', async () => {
    const t = await started([snapshot(1)]);
    t.store.focus('INFY');
    t.store.focus('INFY');
    t.emit(frame(1, { depth: depth() }));
    t.runFrame();
    expect(t.store.getState().depth?.symbol).toBe('INFY');
    t.store.focus('TCS');
    t.runFrame();
    expect(t.focusCalls).toEqual([null, 'INFY', 'TCS']);
    expect(t.store.getState()).toMatchObject({
      depth: null,
      focus: { symbol: 'TCS', exchange: 'NSE' },
    });
    t.store.dispose();
    t.emit(frame(2, { orders: [order('o1', 2)] }));
    expect(t.frames).toHaveLength(0);
  });
});
