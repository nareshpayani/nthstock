import { Quote, quoteSnapshotKey, type Exchange } from '@nthstock/contracts';
import { followTickStreams, type MockMarketDataAdapter } from '@nthstock/marketData';
import { shardOf } from '@nthstock/utils';
import { Redis } from 'ioredis';
import type { PublisherLog } from './publisher.js';

export type QuoteStreamsOptions = {
  /** `REDIS_URL`, the Redis apps/quotes writes to. */
  url: string;
  /** `QUOTE_SHARDS`: how many shards apps/quotes writes. */
  shards: number;
  /** Key names for a shard; tests pass their own so suites can share one Redis. */
  streamKey?: (shard: number) => string;
  snapshotKey?: (shard: number) => string;
  /** How long one `XREAD BLOCK` waits; default 5 s (tests use less, to close fast). */
  blockMs?: number;
  log: PublisherLog;
};

export type QuoteStreams = {
  /**
   * The quotes for `symbols` from the shards' snapshots (spec market-data-and-matching §4), in the
   * order asked, so every API instance answers the LTP the quote service last wrote. An instrument
   * the snapshot does not have yet (the quote service has not written it) falls back to the
   * adapter; unknown symbols are left out, as `MarketDataAdapter.getQuotes` does.
   */
  getQuotes(symbols: readonly string[], exchange?: Exchange): Promise<Quote[]>;
  /** Resolves once the snapshots are loaded into the adapter and the streams are followed. */
  ready(): Promise<void>;
  close(): Promise<void>;
};

/**
 * apps/api on the quote service (NSTOCK-0354): the adapter generates no ticks of its own
 * (`externalTicks`) and moves on the tick streams instead, so the paper desk, alerts, lists,
 * movers and candles all follow the one quote service. `getQuotes` reads the snapshots directly.
 */
export function startQuoteStreams(
  market: MockMarketDataAdapter,
  options: QuoteStreamsOptions,
): QuoteStreams {
  const { shards, log } = options;
  const snapshotKey = options.snapshotKey ?? quoteSnapshotKey;
  // XREAD BLOCK holds its connection, so the follower gets one of its own.
  const follow = new Redis(options.url, { maxRetriesPerRequest: null });
  const reads = new Redis(options.url, { maxRetriesPerRequest: 1, commandTimeout: 1_000 });
  let down = false;
  const onError = (error: Error) => {
    if (down) return;
    down = true;
    log.warn(`Quote streams unavailable: ${error.message}`);
  };
  const onReady = () => {
    if (down) log.info('Quote streams reconnected');
    down = false;
  };
  for (const client of [follow, reads]) client.on('error', onError).on('ready', onReady);

  const follower = followTickStreams({
    client: follow,
    shards,
    ...(options.streamKey ? { streamKey: options.streamKey } : {}),
    snapshotKey,
    ...(options.blockMs === undefined ? {} : { blockMs: options.blockMs }),
    log: {
      warn: (message, fields) =>
        log.warn(fields ? `${message} ${JSON.stringify(fields)}` : message),
      info: (message) => log.info(message),
    },
    onQuotes: (quotes) => market.applyQuotes(quotes),
  });

  return {
    async getQuotes(symbols, exchange) {
      const wanted: { symbol: string; token: number; shard: number }[] = [];
      for (const symbol of symbols) {
        const instrument = await market.getInstrument(symbol, exchange);
        if (instrument) {
          wanted.push({
            symbol,
            token: instrument.token,
            shard: shardOf(instrument.token, shards),
          });
        }
      }
      const pipeline = reads.pipeline();
      for (const { token, shard } of wanted) pipeline.hget(snapshotKey(shard), String(token));
      // With Redis down the adapter still has the last prices the streams brought.
      const results =
        wanted.length === 0
          ? []
          : await pipeline.exec().catch((error: unknown) => {
              log.warn(`Quote snapshot read failed for ${wanted.length} symbols: ${String(error)}`);
              return null;
            });
      const rows = results ?? [];
      const quotes: Quote[] = [];
      let unusable = 0;
      for (const [index, { symbol }] of wanted.entries()) {
        const [error, row] = rows[index] ?? [null, null];
        const parsed =
          !error && typeof row === 'string' ? Quote.safeParse(safeJson(row)) : undefined;
        // A row that is missing is normal before the first write; an error or a corrupt row is not.
        if (error || (row != null && !parsed?.success)) unusable += 1;
        const quote = parsed?.success ? parsed.data : await market.getQuote(symbol, exchange);
        if (quote) quotes.push(quote);
      }
      if (unusable > 0 && results) {
        log.warn(`Quote snapshot read failed for ${unusable} symbols`);
      }
      return quotes;
    },
    ready: () => follower.ready(),
    async close() {
      await follower.close();
      reads.disconnect();
    },
  };
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
