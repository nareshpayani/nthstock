import type { Exchange, Quote } from '@nthstock/contracts';

/** Direction of the last price change: drives the flash and the ▲▼ next to a live price. */
export type TickDirection = 'up' | 'down' | 'flat';

/** What a price cell reads: the latest quote plus how the last trade price moved. */
export type LiveQuote = {
  readonly quote: Quote;
  /** Direction of the last LTP change; stays put across updates that leave LTP unchanged. */
  readonly tick: TickDirection;
  /** Increments on every LTP change, so a cell can restart its flash animation. */
  readonly seq: number;
};

/** Where live quotes come from: the WS client in the app, a fake in tests. */
export type QuoteSource = {
  subscribe(symbol: string, exchange: Exchange): () => void;
  onQuotes(listener: (quotes: readonly Quote[]) => void): () => void;
};

/** Runs `flush` once, soon; one call per frame. Defaults to requestAnimationFrame. */
export type FrameScheduler = (flush: () => void) => void;

type RafGlobal = { requestAnimationFrame?: (callback: () => void) => unknown };

export const animationFrameScheduler: FrameScheduler = (flush) => {
  const raf = (globalThis as RafGlobal).requestAnimationFrame;
  if (raf) raf(flush);
  else setTimeout(flush, 16);
};

export const quoteKey = (symbol: string, exchange: Exchange = 'NSE') => `${exchange}:${symbol}`;

export type QuoteStore = {
  /** The latest committed quote; the same object until the next change (useSyncExternalStore). */
  get(symbol: string, exchange?: Exchange): LiveQuote | undefined;
  /**
   * Listens to one symbol. The first listener subscribes the symbol at the source, the last one
   * to leave unsubscribes it.
   */
  subscribe(symbol: string, exchange: Exchange, listener: () => void): () => void;
  /** Queues quotes; they are committed (and listeners called) once, on the next frame. */
  ingest(quotes: readonly Quote[]): void;
  /** Commits queued quotes now. The scheduler calls this; tests may too. */
  flush(): void;
  /** Symbols with at least one listener. */
  activeSymbols(): string[];
  dispose(): void;
};

export type QuoteStoreOptions = {
  source?: QuoteSource;
  schedule?: FrameScheduler;
};

/**
 * Live prices outside React (T-056, ADR 0005 UI-03). Ticks land in a pending map (last one wins),
 * and one animation-frame flush commits them and notifies only the listeners of symbols that
 * changed, so 100 ticks in a frame cost one render of one cell.
 */
export function createQuoteStore(options: QuoteStoreOptions = {}): QuoteStore {
  const schedule = options.schedule ?? animationFrameScheduler;
  const source = options.source;
  const committed = new Map<string, LiveQuote>();
  const pending = new Map<string, Quote>();
  const listeners = new Map<string, Set<() => void>>();
  const releases = new Map<string, () => void>();
  let flushQueued = false;
  let disposed = false;

  const flush = () => {
    flushQueued = false;
    if (pending.size === 0) return;
    const changed: string[] = [];
    for (const [key, quote] of pending) {
      const previous = committed.get(key);
      let tick: TickDirection = previous?.tick ?? 'flat';
      let seq = previous?.seq ?? 0;
      if (previous && quote.ltp !== previous.quote.ltp) {
        tick = quote.ltp > previous.quote.ltp ? 'up' : 'down';
        seq += 1;
      }
      committed.set(key, { quote, tick, seq });
      changed.push(key);
    }
    pending.clear();
    for (const key of changed) {
      const set = listeners.get(key);
      if (set) for (const listener of [...set]) listener();
    }
  };

  const ingest = (quotes: readonly Quote[]) => {
    if (disposed || quotes.length === 0) return;
    for (const quote of quotes) pending.set(quoteKey(quote.symbol, quote.exchange), quote);
    if (!flushQueued) {
      flushQueued = true;
      schedule(flush);
    }
  };

  const detach = source?.onQuotes(ingest);

  return {
    get: (symbol, exchange) => committed.get(quoteKey(symbol, exchange)),
    subscribe(symbol, exchange, listener) {
      const key = quoteKey(symbol, exchange);
      let set = listeners.get(key);
      if (!set) {
        set = new Set();
        listeners.set(key, set);
        if (source && !disposed) releases.set(key, source.subscribe(symbol, exchange));
      }
      set.add(listener);
      const own = set;
      return () => {
        own.delete(listener);
        if (own.size === 0 && listeners.get(key) === own) {
          listeners.delete(key);
          releases.get(key)?.();
          releases.delete(key);
        }
      };
    },
    ingest,
    flush,
    activeSymbols: () => [...listeners.keys()],
    dispose() {
      disposed = true;
      detach?.();
      for (const release of releases.values()) release();
      releases.clear();
      listeners.clear();
      pending.clear();
    },
  };
}
