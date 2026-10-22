/** Shared fixtures for the engine tests. Not part of the build. */
import { Order, TrailingStop, type PlaceOrderRequest } from '@nthstock/contracts';
import { fromIst } from '@nthstock/utils';
import {
  createEngineContext,
  createManualClock,
  createMapPriceSource,
  type ManualClock,
  type MapPriceSource,
} from './context.js';
import {
  createMapInstrumentSource,
  type InstrumentInfo,
  type MapInstrumentSource,
} from './instruments.js';
import {
  PAPER_ENGINE_LEGACY_SNAPSHOT_VERSION,
  PaperEngine,
  type PaperEngineOptions,
  type PaperEngineSnapshotV1,
} from './paperEngine.js';

export const INFY: InstrumentInfo = {
  token: 1594,
  symbol: 'INFY',
  exchange: 'NSE',
  lowerCircuit: 1_200_00,
  upperCircuit: 1_800_00,
};
export const TCS: InstrumentInfo = {
  token: 11536,
  symbol: 'TCS',
  exchange: 'NSE',
  lowerCircuit: 3_000_00,
  upperCircuit: 4_500_00,
};

/** An IST wall-clock instant in 2026. Friday 25 Sep 2026 is a trading day. */
export const ist = (day: number, hour: number, minute: number, month = 9): Date =>
  fromIst(2026, month, day, hour * 60 + minute);

export type Harness = {
  engine: PaperEngine;
  clock: ManualClock;
  prices: MapPriceSource;
  instruments: MapInstrumentSource;
  updates: Order[];
  stopUpdates: TrailingStop[];
};

export function createHarness(
  options: { at?: Date } & Partial<Omit<PaperEngineOptions, 'ctx' | 'instruments'>> = {},
): Harness {
  const { at, ...rest } = options;
  const clock = createManualClock(at ?? ist(25, 10, 0));
  const prices = createMapPriceSource([
    [INFY.token, 1_500_00],
    [TCS.token, 3_800_00],
  ]);
  const instruments = createMapInstrumentSource([INFY, TCS]);
  const updates: Order[] = [];
  const stopUpdates: TrailingStop[] = [];
  const engine = new PaperEngine({
    ctx: createEngineContext({ clock, prices }),
    instruments,
    onOrderUpdate: (order) => {
      // Every update must be a valid contract Order (it becomes an orderUpdate frame).
      updates.push(Order.parse(order));
    },
    onTrailingStopUpdate: (stop) => {
      stopUpdates.push(TrailingStop.parse(stop));
    },
    ...rest,
  });
  return { engine, clock, prices, instruments, updates, stopUpdates };
}

export const order = (overrides: Partial<PlaceOrderRequest> = {}): PlaceOrderRequest => ({
  token: INFY.token,
  side: 'BUY',
  type: 'LIMIT',
  product: 'DELIVERY',
  qty: 10,
  price: 1_490_00,
  ...overrides,
});

export const marketOrder = (overrides: Partial<PlaceOrderRequest> = {}): PlaceOrderRequest => ({
  token: INFY.token,
  side: 'BUY',
  type: 'MARKET',
  product: 'DELIVERY',
  qty: 10,
  ...overrides,
});

/** A small seeded PRNG (mulberry32) for reproducible randomised tests. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The engine's state as a version 1 snapshot, as saved before trailing stops and `seq`. */
export function legacySnapshot(engine: PaperEngine): PaperEngineSnapshotV1 {
  const { seq, trailingStops, exitOrderIds, trailingStopRequestIds, orders, ...rest } =
    engine.snapshot();
  void [seq, trailingStops, exitOrderIds, trailingStopRequestIds];
  return {
    ...rest,
    v: PAPER_ENGINE_LEGACY_SNAPSHOT_VERSION,
    orders: orders.map(({ seq: orderSeq, ...order }) => {
      void orderSeq;
      return order;
    }),
  };
}
