import { quoteSnapshotKey, tickStreamKey, type Quote } from '@nthstock/contracts';
import {
  followTickStreams,
  type TickStreamClient,
  type TickStreamFollower,
  type TickStreamFollowerOptions,
} from '@nthstock/marketData';
import { OrderBook, type BookAlert, type BookTick } from '@nthstock/paperEngine';
import { getMarketStatus } from '@nthstock/utils';
import { applyCommand, readMatcherCommands, type CommandStreamClient } from './commands.js';
import { startReconcileLoop, type LiveOrderSource, type ReconcileLoop } from './reconcile.js';

export type MatcherLog = {
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
};

/** What one tick did to one instrument's book; only ticks that acted are reported. */
export type MatcherTick = BookTick & { token: number; symbol: string; ltp: number; ts: string };

/** The alerts one tick fired on one instrument, and the tick that fired them. */
export type FiredAlerts = {
  token: number;
  symbol: string;
  ltp: number;
  ts: string;
  alerts: BookAlert[];
};

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
  /**
   * Called with the price alerts a tick fired (NSTOCK-0383), already off the book. The server
   * stores each as TRIGGERED with its notification, exactly once whoever fires it first.
   */
  onAlerts?: (fired: FiredAlerts) => void;
  log: MatcherLog;
  /** Tests pass shorter reads and their own keys. */
  blockMs?: number;
  streamKey?: (shard: number) => string;
  snapshotKey?: (shard: number) => string;
  /** The follower; tests replace it to drive ticks by hand. */
  follow?: (options: TickStreamFollowerOptions) => TickStreamFollower;
  /**
   * The shard's order commands from apps/api (NSTOCK-0365), read on a connection of their own.
   * Every process for the shard applies them, so a standby's books are current too.
   */
  commands?: { client: CommandStreamClient; commandsKey?: (shard: number) => string };
  /**
   * Reconciles the books with Postgres on start and every 60 s (NSTOCK-0366), which repairs a
   * lost command. `shards` is the shard count, for rows recorded before the shard column.
   */
  reconcile?: {
    source: LiveOrderSource;
    shards: number;
    everyMs?: number;
    timer?: Parameters<typeof startReconcileLoop>[0]['timer'];
  };
};

export type Matcher = {
  /** The instrument's book, created on first use. */
  book(token: number): OrderBook;
  /** The books created so far, by token. */
  readonly books: ReadonlyMap<number, OrderBook>;
  /** The reconcile loop, when Postgres is configured. */
  readonly reconcile: ReconcileLoop | null;
  /**
   * Ticks seen, ticks acted on (lease held, market open, a book for the instrument), and order
   * commands that changed a book.
   */
  stats(): { ticks: number; acted: number; commands: number };
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
 * The books are filled by order commands (NSTOCK-0365) and the reconcile loop (NSTOCK-0366); fills
 * commit through the account store (NSTOCK-0367). Until then `onTick` reports what crossed.
 */
export function startMatcher(options: MatcherOptions): Matcher {
  const { shard, holdsLease, alwaysOpen, onTick, log } = options;
  const books = new Map<number, OrderBook>();
  let ticks = 0;
  let acted = 0;
  let commands = 0;

  const open = (ts: string) =>
    alwaysOpen || getMarketStatus({ now: () => new Date(ts) }).state === 'open';

  function apply(quotes: readonly Quote[]) {
    for (const quote of quotes) {
      ticks += 1;
      const book = books.get(quote.token);
      if (!book || !holdsLease() || !open(quote.ts)) continue;
      acted += 1;
      const result = book.tick(quote.ltp);
      if (result.alerts.length > 0) {
        const { token, symbol, ltp, ts } = quote;
        options.onAlerts?.({ token, symbol, ltp, ts, alerts: result.alerts });
      }
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

  function book(token: number): OrderBook {
    let found = books.get(token);
    if (!found) {
      found = new OrderBook();
      books.set(token, found);
    }
    return found;
  }

  const reader =
    options.commands &&
    readMatcherCommands({
      client: options.commands.client,
      shard,
      ...(options.commands.commandsKey ? { commandsKey: options.commands.commandsKey } : {}),
      ...(options.blockMs === undefined ? {} : { blockMs: options.blockMs }),
      log,
      onCommand: (command) => {
        // A cancel for an instrument with no book has nothing to take off.
        const removes =
          command.type === 'CANCEL' ||
          command.type === 'STOP_CANCEL' ||
          command.type === 'ALERT_CANCEL';
        const target = removes ? books.get(command.token) : book(command.token);
        if (target && applyCommand(target, command)) commands += 1;
      },
    });

  // The first round waits for the command reader's first read, so a command written during it is
  // not missed: it lands either in that round or on the stream the reader already waits on.
  const reconcile = options.reconcile
    ? startReconcileLoop({
        source: options.reconcile.source,
        shard,
        shards: options.reconcile.shards,
        books,
        book,
        log,
        ...(reader ? { after: reader.ready() } : {}),
        ...(options.reconcile.everyMs === undefined ? {} : { everyMs: options.reconcile.everyMs }),
        ...(options.reconcile.timer === undefined ? {} : { timer: options.reconcile.timer }),
      })
    : null;

  return {
    book,
    books,
    reconcile,
    stats: () => ({ ticks, acted, commands }),
    ready: async () => {
      await Promise.all([follower.ready(), reader?.ready()]);
      await reconcile?.ready();
    },
    close: async () => {
      await reconcile?.stop();
      await Promise.all([follower.close(), reader?.close()]);
    },
  };
}
