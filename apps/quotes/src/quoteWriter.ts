import {
  TICK_BATCH_VERSION,
  TICKS_CHANNEL,
  type Exchange,
  type TickBatch,
} from '@nthstock/contracts';
import type { MarketDataAdapter, Unsubscribe } from '@nthstock/marketData';
import { shardOf } from '@nthstock/utils';

/** Where tick batches go. Redis in the running service; a recorder in unit tests. */
export type TickPublisher = {
  publish(channel: string, message: string): Promise<unknown>;
};

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
  publisher: TickPublisher;
  /** Defaults to `TICKS_CHANNEL`; tests use their own to share one Redis safely. */
  channel?: string;
  log: QuoteWriterLog;
};

export type QuoteWriter = {
  /** The instruments this shard writes. */
  readonly tokens: ReadonlySet<number>;
  /** Unsubscribes from the adapter. Safe to call more than once. */
  stop(): void;
};

/**
 * Writes the ticks of one shard's instruments (spec market-data-and-matching §4): it subscribes
 * to them on the market adapter and publishes each batch, but only while this process holds the
 * shard's lease, so a second process for the same shard stays silent until it takes over. A
 * failed publish is dropped (the next tick supersedes it) and logged once until it recovers.
 */
export async function startQuoteWriter(options: QuoteWriterOptions): Promise<QuoteWriter> {
  const { market, shard, shards, holdsLease, publisher, log } = options;
  const channel = options.channel ?? TICKS_CHANNEL;
  const tokens = new Set<number>();
  const byExchange = new Map<Exchange, string[]>();
  for (const instrument of await market.listInstruments()) {
    if (shardOf(instrument.token, shards) !== shard) continue;
    tokens.add(instrument.token);
    const symbols = byExchange.get(instrument.exchange) ?? [];
    symbols.push(instrument.symbol);
    byExchange.set(instrument.exchange, symbols);
  }

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
          const batch: TickBatch = { v: TICK_BATCH_VERSION, quotes: [...quotes] };
          publisher.publish(channel, JSON.stringify(batch)).then(onPublished, onFailed);
        },
        exchange,
      ),
    );
  }

  return {
    tokens,
    stop() {
      for (const unsubscribe of unsubscribes.splice(0)) unsubscribe();
    },
  };
}
