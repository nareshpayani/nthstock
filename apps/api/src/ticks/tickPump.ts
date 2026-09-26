import {
  TICK_BATCH_VERSION,
  TICKS_CHANNEL,
  type Exchange,
  type TickBatch,
} from '@nthstock/contracts';
import type { MarketDataAdapter, Unsubscribe } from '@nthstock/marketData';
import type { Publisher, PublisherLog } from './publisher.js';

export type TickPump = {
  /** Unsubscribes from the adapter. Safe to call more than once. */
  stop(): void;
};

export type TickPumpOptions = {
  market: MarketDataAdapter;
  publisher: Publisher;
  /** Defaults to `TICKS_CHANNEL`; tests use their own to share one Redis safely. */
  channel?: string;
  log: PublisherLog;
};

/**
 * Publishes every adapter tick to Redis (T-071, ADR 0004 §4). It subscribes to the whole symbol
 * master, one subscription per exchange, and publishes each tick's batch as one `TickBatch`
 * message; apps/realtime fans them out. A failed publish is dropped (the next tick supersedes it)
 * and logged once until publishing recovers.
 */
export async function startTickPump(options: TickPumpOptions): Promise<TickPump> {
  const { market, publisher, log } = options;
  const channel = options.channel ?? TICKS_CHANNEL;
  const instruments = await market.listInstruments();
  const byExchange = new Map<Exchange, string[]>();
  for (const instrument of instruments) {
    const symbols = byExchange.get(instrument.exchange) ?? [];
    symbols.push(instrument.symbol);
    byExchange.set(instrument.exchange, symbols);
  }

  let failing = false;
  const onPublished = () => {
    if (failing) log.info('Tick publishing recovered');
    failing = false;
  };
  const onFailed = (error: unknown) => {
    if (failing) return;
    failing = true;
    log.warn(`Tick publishing failed: ${error instanceof Error ? error.message : String(error)}`);
  };

  const unsubscribes: Unsubscribe[] = [];
  for (const [exchange, symbols] of byExchange) {
    unsubscribes.push(
      market.subscribe(
        symbols,
        (quotes) => {
          if (quotes.length === 0) return;
          const batch: TickBatch = { v: TICK_BATCH_VERSION, quotes: [...quotes] };
          publisher.publish(channel, JSON.stringify(batch)).then(onPublished, onFailed);
        },
        exchange,
      ),
    );
  }

  return {
    stop() {
      for (const unsubscribe of unsubscribes.splice(0)) unsubscribe();
    },
  };
}
