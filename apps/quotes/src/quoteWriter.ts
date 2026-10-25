import { TICK_BATCH_VERSION, type Exchange } from '@nthstock/contracts';
import type { MarketDataAdapter, Unsubscribe } from '@nthstock/marketData';
import { shardOf } from '@nthstock/utils';
import type { TickSink } from './tickStream.js';

export type QuoteWriterLog = {
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
};

export type QuoteWriterOptions = {
  market: MarketDataAdapter;
  shard: number;
  shards: number;
  /** Whether this process holds the shard's lease right now. */
  holdsLease: () => boolean;
  sink: TickSink;
  log: QuoteWriterLog;
};

export type QuoteWriter = {
  /** The instruments this shard writes. */
  readonly tokens: ReadonlySet<number>;
  /** The `seq` of the last batch handed to the sink (0 before the first). */
  readonly seq: number;
  /** Unsubscribes from the adapter. Safe to call more than once. */
  stop(): void;
};

/**
 * Writes the ticks of one shard's instruments (spec market-data-and-matching §4): it subscribes
 * to them on the market adapter and appends each batch, numbered by `seq`, to the shard's stream,
 * but only while this process holds the shard's lease, so a second process for the same shard
 * stays silent until it takes over. A failed write is dropped (the next tick supersedes it, and
 * its `seq` gap sends consumers to the snapshot) and logged once until writing recovers.
 */
export async function startQuoteWriter(options: QuoteWriterOptions): Promise<QuoteWriter> {
  const { market, shard, shards, holdsLease, sink, log } = options;
  const tokens = new Set<number>();
  const byExchange = new Map<Exchange, string[]>();
  for (const instrument of await market.listInstruments()) {
    if (shardOf(instrument.token, shards) !== shard) continue;
    tokens.add(instrument.token);
    const symbols = byExchange.get(instrument.exchange) ?? [];
    symbols.push(instrument.symbol);
    byExchange.set(instrument.exchange, symbols);
  }

  let seq = 0;
  let failing = false;
  const onPublished = () => {
    if (failing) log.info('tick publishing recovered', { shard });
    failing = false;
  };
  const onFailed = (error: unknown) => {
    if (failing) return;
    failing = true;
    log.warn('tick publishing failed', { shard, error: String(error) });
  };

  const unsubscribes: Unsubscribe[] = [];
  for (const [exchange, symbols] of byExchange) {
    unsubscribes.push(
      market.subscribe(
        symbols,
        (quotes) => {
          if (quotes.length === 0 || !holdsLease()) return;
          seq += 1;
          sink
            .append({ v: TICK_BATCH_VERSION, shard, seq, quotes: [...quotes] })
            .then(onPublished, onFailed);
        },
        exchange,
      ),
    );
  }

  return {
    tokens,
    get seq() {
      return seq;
    },
    stop() {
      for (const unsubscribe of unsubscribes.splice(0)) unsubscribe();
    },
  };
}
