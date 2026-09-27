import {
  TICK_SIZE_PAISE,
  type Exchange,
  type InstrumentToken,
  type OrderSide,
  type TradingSymbol,
  type Watchlist,
} from '@nthstock/contracts';
import { fromIst } from '@nthstock/utils';
import {
  createEngineContext,
  createManualClock,
  createMapPriceSource,
  createSequentialIds,
} from './context.js';
import { createMapInstrumentSource } from './instruments.js';
import { PaperEngine, type PaperEngineSnapshot } from './paperEngine.js';

/**
 * The demo starting state (T-174): one user, two watchlists, some holdings and a funds ledger
 * history. Both backends load it from here, so `npm run seed:demo` (api mode) and `?demo=1` (msw
 * mode) start from the same state: apps/api in `src/demo/seedDemo.ts`, MSW in
 * `apps/web/src/mocks/demoSeed.ts`. Runbook: `docs/runbooks/local-demo.md`.
 *
 * Everything is deterministic: fixed dates, prices derived from the symbol master's base prices
 * (the same seeded master in both modes), and sequential order and ledger ids.
 */

/** The demo user both backends already seed (`DEMO_USER` in apps/api, `MOCK_DEMO_USER` in MSW). */
export const DEMO_SEED_USER = {
  id: 'usr_demo',
  /** A made-up number, not a real subscriber. Log in with the dev OTP 123456. */
  mobile: '9000000001',
} as const;

/** When the demo watchlists were "made"; their createdAt, updatedAt and addedAt. */
export const DEMO_SEEDED_AT = '2026-09-25T12:00:00.000Z';

export type DemoWatchlistDef = { id: string; name: string; symbols: readonly TradingSymbol[] };

export const DEMO_WATCHLISTS: readonly DemoWatchlistDef[] = [
  {
    id: 'wl_demo_1',
    name: 'My Watchlist',
    symbols: ['RELIANCE', 'HDFCBANK', 'TCS', 'INFY', 'ITC', 'BHARTIARTL'],
  },
  {
    id: 'wl_demo_2',
    name: 'Banks',
    symbols: ['ICICIBANK', 'SBIN', 'KOTAKBANK', 'AXISBANK', 'BAJFINANCE'],
  },
];

/**
 * One past delivery trade, filled at market. `day` is a September 2026 trading day; `minute` the
 * IST minute of the day; `priceBp` the fill price in basis points of the symbol's base price.
 */
export type DemoTrade = {
  day: number;
  minute: number;
  symbol: TradingSymbol;
  side: OrderSide;
  qty: number;
  priceBp: number;
};

const at = (hour: number, minute: number) => hour * 60 + minute;

/** Buys over two weeks, then a partial profit-taking sale: holdings plus a ledger history. */
export const DEMO_TRADES: readonly DemoTrade[] = [
  { day: 15, minute: at(10, 5), symbol: 'RELIANCE', side: 'BUY', qty: 20, priceBp: 9_700 },
  { day: 15, minute: at(11, 30), symbol: 'INFY', side: 'BUY', qty: 30, priceBp: 9_900 },
  { day: 16, minute: at(10, 15), symbol: 'HDFCBANK', side: 'BUY', qty: 40, priceBp: 9_800 },
  { day: 18, minute: at(14, 0), symbol: 'TCS', side: 'BUY', qty: 10, priceBp: 10_100 },
  { day: 22, minute: at(10, 45), symbol: 'ITC', side: 'BUY', qty: 150, priceBp: 9_600 },
  { day: 24, minute: at(13, 20), symbol: 'INFY', side: 'SELL', qty: 10, priceBp: 10_300 },
];

/** The last trading day's close has passed: every buy has settled into holdings. */
const SETTLED_AT = fromIst(2026, 9, 25, at(16, 0));

/** What the seed needs to know about a symbol: from the symbol master (`MasterEquity`). */
export type DemoInstrument = {
  token: InstrumentToken;
  symbol: TradingSymbol;
  exchange: Exchange;
  name: string;
  /** Previous close at the start of the simulation, paise. */
  basePrice: number;
};

/** Every symbol the demo uses, so a caller can look them up. */
export const DEMO_SYMBOLS: readonly TradingSymbol[] = [
  ...new Set([
    ...DEMO_WATCHLISTS.flatMap((list) => list.symbols),
    ...DEMO_TRADES.map((t) => t.symbol),
  ]),
];

const onTick = (paise: number) => Math.round(paise / TICK_SIZE_PAISE) * TICK_SIZE_PAISE;

/** `basePrice × bp / 10,000` on the 5-paise tick. Integer paise throughout. */
export const demoPrice = (basePrice: number, bp: number) =>
  onTick(Math.round((basePrice * bp) / 10_000));

function lookup(instruments: Iterable<DemoInstrument>): (symbol: TradingSymbol) => DemoInstrument {
  const bySymbol = new Map<string, DemoInstrument>();
  for (const instrument of instruments) {
    // NSE first: the demo trades and lists the NSE line of a stock.
    const known = bySymbol.get(instrument.symbol);
    if (!known || (known.exchange !== 'NSE' && instrument.exchange === 'NSE')) {
      bySymbol.set(instrument.symbol, instrument);
    }
  }
  return (symbol) => {
    const found = bySymbol.get(symbol);
    if (!found) throw new Error(`Demo seed: ${symbol} is not in the symbol master`);
    return found;
  };
}

/** The two demo watchlists, as both backends answer `GET /v1/watchlists`. */
export function demoWatchlists(instruments: Iterable<DemoInstrument>): Watchlist[] {
  const find = lookup(instruments);
  return DEMO_WATCHLISTS.map((list) => ({
    id: list.id,
    name: list.name,
    items: list.symbols.map((symbol) => {
      const { token, exchange, name } = find(symbol);
      return { token, symbol, exchange, name, addedAt: DEMO_SEEDED_AT };
    }),
    createdAt: DEMO_SEEDED_AT,
    updatedAt: DEMO_SEEDED_AT,
  }));
}

/**
 * The demo paper account: `DEMO_TRADES` replayed on a real engine with a scripted clock and
 * prices, then carried past the close so the buys are holdings. Restore it with
 * `PaperDesk.restore(DEMO_SEED_USER.id, snapshot)`.
 */
export function buildDemoAccount(instruments: Iterable<DemoInstrument>): PaperEngineSnapshot {
  const find = lookup(instruments);
  const traded = [...new Set(DEMO_TRADES.map((trade) => trade.symbol))].map(find);
  const first = DEMO_TRADES[0];
  if (!first) throw new Error('Demo seed: no trades');
  const clock = createManualClock(fromIst(2026, 9, first.day, first.minute));
  const prices = createMapPriceSource();
  const engine = new PaperEngine({
    ctx: createEngineContext({ clock, prices, nextId: createSequentialIds('pe_demo_') }),
    instruments: createMapInstrumentSource(
      traded.map(({ token, symbol, exchange, basePrice }) => ({
        token,
        symbol,
        exchange,
        // A wide band: every scripted fill sits well inside it.
        lowerCircuit: demoPrice(basePrice, 5_000),
        upperCircuit: demoPrice(basePrice, 15_000),
      })),
    ),
  });
  DEMO_TRADES.forEach((trade, index) => {
    const instrument = find(trade.symbol);
    clock.set(fromIst(2026, 9, trade.day, trade.minute));
    prices.set(instrument.token, demoPrice(instrument.basePrice, trade.priceBp));
    const result = engine.place({
      token: instrument.token,
      side: trade.side,
      type: 'MARKET',
      product: 'DELIVERY',
      qty: trade.qty,
      clientOrderId: `demo-${String(index + 1)}`,
    });
    if (!result.ok || result.order?.status !== 'EXECUTED') {
      throw new Error(`Demo seed: trade ${String(index + 1)} (${trade.symbol}) did not fill`);
    }
  });
  clock.set(SETTLED_AT);
  engine.sync();
  return engine.snapshot();
}
