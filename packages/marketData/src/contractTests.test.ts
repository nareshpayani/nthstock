import type {
  CandleRange,
  CandleSeries,
  Depth,
  IndexSummary,
  Instrument,
  InstrumentStats,
  MoverDirection,
  Movers,
  Quote,
  QuoteRow,
  SearchHit,
  StockList,
} from '@nthstock/contracts';
import type { MarketDataAdapter, QuoteListener } from './adapter.js';
import { runAdapterContractTests } from './contractTests.js';

const TS = '2026-09-25T05:00:00.000Z';

const instruments: Instrument[] = [
  {
    token: 1,
    symbol: 'ALPHA',
    exchange: 'NSE',
    name: 'Alpha Ltd',
    type: 'EQUITY',
    isin: 'INE000001011',
    sector: 'FMCG',
    lotSize: 1,
    tickSize: 5,
  },
  {
    token: 2,
    symbol: 'BETA',
    exchange: 'NSE',
    name: 'Beta Ltd',
    type: 'EQUITY',
    isin: 'INE000002012',
    sector: 'FMCG',
    lotSize: 1,
    tickSize: 5,
  },
  {
    token: 9,
    symbol: 'IDX',
    exchange: 'NSE',
    name: 'Stub Index',
    type: 'INDEX',
    isin: null,
    sector: null,
    lotSize: 1,
    tickSize: 5,
  },
];

const quotes: Record<string, Quote> = {
  ALPHA: {
    token: 1,
    symbol: 'ALPHA',
    exchange: 'NSE',
    ltp: 10_100,
    change: 100,
    changeBp: 100,
    open: 10_000,
    high: 10_200,
    low: 9_950,
    prevClose: 10_000,
    volume: 10,
    ts: TS,
  },
  BETA: {
    token: 2,
    symbol: 'BETA',
    exchange: 'NSE',
    ltp: 9_900,
    change: -100,
    changeBp: -100,
    open: 10_000,
    high: 10_050,
    low: 9_850,
    prevClose: 10_000,
    volume: 20,
    ts: TS,
  },
  IDX: {
    token: 9,
    symbol: 'IDX',
    exchange: 'NSE',
    ltp: 1_000_000,
    change: 0,
    changeBp: 0,
    open: 1_000_000,
    high: 1_000_000,
    low: 1_000_000,
    prevClose: 1_000_000,
    volume: 0,
    ts: TS,
  },
};

const row = (q: Quote): QuoteRow => ({
  token: q.token,
  symbol: q.symbol,
  exchange: q.exchange,
  name: instruments.find((i) => i.symbol === q.symbol)?.name ?? q.symbol,
  ltp: q.ltp,
  change: q.change,
  changeBp: q.changeBp,
});

/** The smallest adapter that satisfies the contract: fixed data, ticks on demand. */
class StubAdapter implements MarketDataAdapter {
  private listeners = new Set<{ symbols: string[]; listener: QuoteListener }>();

  emit(): void {
    for (const { symbols, listener } of [...this.listeners]) {
      listener(symbols.map((s) => quotes[s] as Quote));
    }
  }

  private find(symbol: string, exchange?: string) {
    return instruments.find((i) => i.symbol === symbol && (!exchange || i.exchange === exchange));
  }

  listInstruments() {
    return Promise.resolve(instruments);
  }
  getInstrument(symbol: string, exchange?: string) {
    return Promise.resolve(this.find(symbol, exchange) ?? null);
  }
  search(query: string, limit = 10): Promise<SearchHit[]> {
    const q = query.toUpperCase();
    return Promise.resolve(
      instruments
        .filter((i) => i.symbol.startsWith(q))
        .slice(0, limit)
        .map(({ token, symbol, exchange, name, type }) => ({
          token,
          symbol,
          exchange,
          name,
          type,
        })),
    );
  }
  getQuote(symbol: string) {
    return Promise.resolve(quotes[symbol] ?? null);
  }
  getQuotes(symbols: readonly string[]) {
    return Promise.resolve(symbols.flatMap((s) => (quotes[s] ? [quotes[s]] : [])));
  }
  getCandles(symbol: string, range: CandleRange): Promise<CandleSeries | null> {
    const q = quotes[symbol];
    if (!q) return Promise.resolve(null);
    return Promise.resolve({
      symbol,
      exchange: 'NSE',
      range,
      interval: '1d',
      candles: [
        {
          t: '2026-09-24T03:45:00.000Z',
          o: q.prevClose,
          h: q.prevClose,
          l: q.prevClose,
          c: q.prevClose,
          v: 1,
        },
        { t: TS, o: q.open, h: q.high, l: q.low, c: q.ltp, v: q.volume },
      ],
    });
  }
  getDepth(symbol: string): Promise<Depth | null> {
    const q = quotes[symbol];
    if (!q || symbol === 'IDX') return Promise.resolve(null);
    const levels = (start: number, step: number) =>
      Array.from({ length: 5 }, (_, i) => ({ price: start + i * step, qty: 10, orders: 1 }));
    return Promise.resolve({
      token: q.token,
      symbol,
      exchange: 'NSE',
      bids: levels(q.ltp - 5, -5),
      asks: levels(q.ltp + 5, 5),
      totalBidQty: 50,
      totalAskQty: 50,
      ts: TS,
    });
  }
  getStats(symbol: string): Promise<InstrumentStats | null> {
    const q = quotes[symbol];
    if (!q || symbol === 'IDX') return Promise.resolve(null);
    return Promise.resolve({
      token: q.token,
      symbol,
      exchange: 'NSE',
      open: q.open,
      high: q.high,
      low: q.low,
      prevClose: q.prevClose,
      volume: q.volume,
      week52High: 12_000,
      week52Low: 8_000,
      upperCircuit: 12_000,
      lowerCircuit: 8_000,
      marketCap: null,
      peX100: null,
      dividendYieldBp: null,
      asOf: TS,
    });
  }
  getIndices(): Promise<IndexSummary[]> {
    const q = quotes['IDX'] as Quote;
    return Promise.resolve([
      {
        token: 9,
        symbol: 'IDX',
        name: 'Stub Index',
        exchange: 'NSE',
        value: q.ltp,
        change: 0,
        changeBp: 0,
        sparkline: [q.ltp],
        ts: TS,
      },
    ]);
  }
  getStockLists(): Promise<StockList[]> {
    return Promise.resolve([
      { id: 'stub-list', title: 'Stub', description: null, items: [row(quotes['ALPHA'] as Quote)] },
    ]);
  }
  async getStockList(id: string) {
    return (await this.getStockLists()).find((l) => l.id === id) ?? null;
  }
  getMovers(index: string, direction: MoverDirection): Promise<Movers | null> {
    if (index !== 'IDX') return Promise.resolve(null);
    const items = direction === 'gainers' ? [quotes['ALPHA']] : [quotes['BETA']];
    return Promise.resolve({
      index,
      direction,
      items: items.map((q) => row(q as Quote)),
      asOf: TS,
    });
  }
  subscribe(symbols: readonly string[], listener: QuoteListener) {
    const sub = { symbols: symbols.filter((s) => s in quotes), listener };
    this.listeners.add(sub);
    return () => {
      this.listeners.delete(sub);
    };
  }
  dispose() {
    this.listeners.clear();
  }
}

runAdapterContractTests(() => new StubAdapter(), {
  name: 'stub',
  equity: 'ALPHA',
  index: 'IDX',
  triggerTick: (adapter) => {
    (adapter as StubAdapter).emit();
  },
});
