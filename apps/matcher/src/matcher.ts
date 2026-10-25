import { quoteSnapshotKey, tickStreamKey, type Quote } from '@nthstock/contracts';
import {
  followTickStreams,
  type TickStreamClient,
  type TickStreamFollower,
  type TickStreamFollowerOptions,
} from '@nthstock/marketData';
import { OrderBook, type BookTick } from '@nthstock/paperEngine';
import { getMarketStatus } from '@nthstock/utils';

export type MatcherLog = {
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
};

/** What one tick did to one instrument's book; only ticks that acted are reported. */
export type MatcherTick = BookTick & { token: number; symbol: string; ltp: number; ts: string };

export type MatcherOptions = {
  /** A Redis client of its own: the follower blocks on `XREAD`. */
  client: TickStreamClient;
  /** The shard this process matches; it reads only that shard's stream. */
  shard: number;
  /** Whether this process holds `lease:matcher:{shard}` now; only the holder acts on ticks. */
  holdsLease: () => boolean;
  /** Act outside NSE hours too (`MOCK_MARKET_ALWAYS_OPEN`), for demos. */
  alwaysOpen: boolean;
  /** Called with every tick that crossed, triggered or moved something. */
  onTick: (tick: MatcherTick) => void;
  log: MatcherLog;
  /** Tests pass shorter reads and their own keys. */
  blockMs?: number;
  streamKey?: (shard: number) => string;
  snapshotKey?: (shard: number) => string;
  /** The follower; tests replace it to drive ticks by hand. */
  follow?: (options: TickStreamFollowerOptions) => TickStreamFollower;
};

export type Matcher = {
  /** The instrument's book, created on first use. */
  book(token: number): OrderBook;
  /** The books created so far, by token. */
  readonly books: ReadonlyMap<number, OrderBook>;
  /** Ticks seen, and ticks acted on (lease held, market open, a book for the instrument). */
  stats(): { ticks: number; acted: number };
  ready(): Promise<void>;
  close(): Promise<void>;
};

/**
 * The matcher worker for one shard (spec market-data-and-matching §5, NSTOCK-0364). It follows
 * the shard's tick stream and runs each instrument's ticks through its `OrderBook`, which reads
 * only the orders and stops a tick acts on. Every process for the shard keeps following the
 * stream, so a standby is current when it takes the lease; only the lease holder acts. Ticks
 * outside market hours are ignored, as the engine ignores them.
 *
 * The book is filled by order commands (NSTOCK-0365) and the reconcile loop (NSTOCK-0366); fills
 * commit through the account store (NSTOCK-0367). Until then `onTick` reports what crossed.
 */
export function startMatcher(options: MatcherOptions): Matcher {
  const { shard, holdsLease, alwaysOpen, onTick, log } = options;
  const books = new Map<number, OrderBook>();
  let ticks = 0;
  let acted = 0;

  const open = (ts: string) =>
    alwaysOpen || getMarketStatus({ now: () => new Date(ts) }).state === 'open';

  function apply(quotes: readonly Quote[]) {
    for (const quote of quotes) {
      ticks += 1;
      const book = books.get(quote.token);
      if (!book || !holdsLease() || !open(quote.ts)) continue;
      acted += 1;
      const result = book.tick(quote.ltp);
      if (result.crossed.length + result.triggered.length + result.moved.length === 0) continue;
      onTick({ ...result, token: quote.token, symbol: quote.symbol, ltp: quote.ltp, ts: quote.ts });
    }
  }

  const streamKey = options.streamKey ?? tickStreamKey;
  const snapshotKey = options.snapshotKey ?? quoteSnapshotKey;
  const follow = options.follow ?? followTickStreams;
  const follower = follow({
    client: options.client,
    // The follower numbers its shards from 0; this process reads only its own.
    shards: 1,
    streamKey: () => streamKey(shard),
    snapshotKey: () => snapshotKey(shard),
    ...(options.blockMs === undefined ? {} : { blockMs: options.blockMs }),
    log,
    onQuotes: apply,
  });

  return {
    book(token) {
      let book = books.get(token);
      if (!book) {
        book = new OrderBook();
        books.set(token, book);
      }
      return book;
    },
    books,
    stats: () => ({ ticks, acted }),
    ready: () => follower.ready(),
    close: () => follower.close(),
  };
}
