import { Watchlist } from '@nthstock/contracts';
import { describe, expect, it } from 'vitest';
import { createEngineContext, createManualClock, createMapPriceSource } from './context.js';
import {
  DEMO_SEEDED_AT,
  DEMO_SYMBOLS,
  DEMO_TRADES,
  DEMO_WATCHLISTS,
  buildDemoAccount,
  demoPrice,
  demoWatchlists,
  type DemoInstrument,
} from './demoSeed.js';
import { createMapInstrumentSource } from './instruments.js';
import { PaperEngine } from './paperEngine.js';

/** A stand-in symbol master: every demo symbol on NSE (and one on BSE, which must lose). */
const instruments: DemoInstrument[] = DEMO_SYMBOLS.flatMap((symbol, index) => {
  const nse: DemoInstrument = {
    token: 1_000 + index,
    symbol,
    exchange: 'NSE',
    name: `${symbol} Ltd`,
    basePrice: 1_000_00 + index * 100_00,
  };
  return index === 0 ? [{ ...nse, token: 9_999, exchange: 'BSE' }, nse] : [nse];
});
const bySymbol = new Map(instruments.filter((i) => i.exchange === 'NSE').map((i) => [i.symbol, i]));

describe('demo seed (T-174)', () => {
  it('prices on the 5-paise tick in integer paise', () => {
    expect(demoPrice(1_380_00, 9_700)).toBe(1_338_60);
    expect(demoPrice(1_001, 10_000)).toBe(1_000);
    expect(Number.isInteger(demoPrice(333_33, 9_999))).toBe(true);
  });

  it('builds two schema-valid watchlists of NSE lines, stamped with the seed time', () => {
    const lists = demoWatchlists(instruments);
    expect(lists.map((l) => l.name)).toEqual(DEMO_WATCHLISTS.map((l) => l.name));
    for (const list of lists) {
      expect(Watchlist.parse(list)).toEqual(list);
      expect(list.createdAt).toBe(DEMO_SEEDED_AT);
      for (const item of list.items) {
        expect(item.token).toBe(bySymbol.get(item.symbol)?.token);
        expect(item.exchange).toBe('NSE');
      }
    }
  });

  it('builds an account with settled holdings and a ledger entry per trade', () => {
    const snapshot = buildDemoAccount(instruments);
    const engine = new PaperEngine({
      ctx: createEngineContext({
        clock: createManualClock(snapshot.syncedTo),
        prices: createMapPriceSource(),
      }),
      instruments: createMapInstrumentSource(),
      snapshot,
    });

    expect(engine.orders().every((order) => order.status === 'EXECUTED')).toBe(true);
    expect(engine.orders()).toHaveLength(DEMO_TRADES.length);
    const types = engine.ledger.entries().map((entry) => entry.type);
    expect(types[0]).toBe('OPENING_CREDIT');
    expect(types.filter((type) => type === 'TRADE_DEBIT')).toHaveLength(
      DEMO_TRADES.filter((trade) => trade.side === 'BUY').length,
    );
    expect(types.filter((type) => type === 'TRADE_CREDIT')).toHaveLength(
      DEMO_TRADES.filter((trade) => trade.side === 'SELL').length,
    );
    expect(engine.positions()).toEqual([]);

    // Holdings: every buy, less the INFY sale.
    const held = new Map<string, number>();
    for (const trade of DEMO_TRADES) {
      held.set(
        trade.symbol,
        (held.get(trade.symbol) ?? 0) + (trade.side === 'BUY' ? 1 : -1) * trade.qty,
      );
    }
    expect(
      engine
        .holdings()
        .map(({ token, lot }) => [
          instruments.find((i) => i.token === token && i.exchange === 'NSE')?.symbol,
          lot.qty,
        ]),
    ).toEqual(expect.arrayContaining([...held]));
    expect(engine.holdings()).toHaveLength(held.size);

    // Cash: the opening balance less buys plus the sale, all in integer paise.
    const net = DEMO_TRADES.reduce((sum, trade) => {
      const price = demoPrice(bySymbol.get(trade.symbol)?.basePrice ?? 0, trade.priceBp);
      return sum + (trade.side === 'BUY' ? -1 : 1) * price * trade.qty;
    }, 0);
    const funds = engine.fundsSummary();
    expect(funds.blocked).toBe(0);
    expect(funds.available).toBe(funds.openingBalance + net);
    expect(engine.ledger.entries().at(-1)?.balanceAfter).toBe(funds.available);
  });

  it('is deterministic', () => {
    expect(buildDemoAccount(instruments)).toEqual(buildDemoAccount(instruments));
  });

  it('refuses a symbol master without a demo symbol', () => {
    expect(() => demoWatchlists(instruments.slice(2))).toThrow(/not in the symbol master/);
  });
});
