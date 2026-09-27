/** Shared fixtures for the engine tests. Not part of the build. */
import { Order, type PlaceOrderRequest } from '@nthstock/contracts';
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
import { PaperEngine, type PaperEngineOptions } from './paperEngine.js';

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
  const engine = new PaperEngine({
    ctx: createEngineContext({ clock, prices }),
    instruments,
    onOrderUpdate: (order) => {
      // Every update must be a valid contract Order (it becomes an orderUpdate frame).
      updates.push(Order.parse(order));
    },
    ...rest,
  });
  return { engine, clock, prices, instruments, updates };
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
