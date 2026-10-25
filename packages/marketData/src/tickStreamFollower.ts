import {
  Quote,
  TickStreamEntry,
  quoteSnapshotKey,
  tickStreamKey,
  tickStreamStep,
} from '@nthstock/contracts';

/** A stream entry as Redis returns it: its id and its flat field/value list. */
export type TickStreamRecord = [id: string, fields: string[]];

/**
 * The Redis calls the follower makes, so this package needs no Redis client of its own: an
 * ioredis client fits it. The follower blocks on `xread`, so give it a connection of its own.
 */
export type TickStreamClient = {
  xrevrange(
    key: string,
    end: '+',
    start: '-',
    count: 'COUNT',
    limit: number,
  ): Promise<TickStreamRecord[]>;
  hvals(key: string): Promise<string[]>;
  xread(...args: (string | number)[]): Promise<unknown>;
  disconnect(): void;
};

export type TickStreamFollowerLog = {
  warn(message: string, fields?: Record<string, unknown>): void;
  info?(message: string, fields?: Record<string, unknown>): void;
};

export type TickStreamFollowerOptions = {
  client: TickStreamClient;
  /** How many shards apps/quotes writes (`SHARDS`); the follower reads every one. */
  shards: number;
  /** Called with each batch, and with a shard's whole snapshot after a resync. */
  onQuotes: (quotes: readonly Quote[]) => void;
  /** Key names for a shard; tests pass their own so suites can share one Redis. */
  streamKey?: (shard: number) => string;
  snapshotKey?: (shard: number) => string;
  /** How long one `XREAD BLOCK` waits before it reads again; default 5 s. */
  blockMs?: number;
  log?: TickStreamFollowerLog;
};

export type TickStreamFollower = {
  /**
   * Resolves once the snapshots are read and the follower waits on the streams, or when it is
   * closed first. Never rejects: with Redis down it stays pending while the follower retries.
   */
  ready(): Promise<void>;
  /** Stops reading and disconnects the client. */
  close(): Promise<void>;
};

const RETRY_MS = 500;
const MAX_RETRY_MS = 10_000;

type TimerGlobal = {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(timer: unknown): void;
};

/** This package has no DOM or Node types, so the timers are looked up on `globalThis`. */
const timers = globalThis as unknown as TimerGlobal;

/**
 * Follows the tick streams apps/quotes writes (spec market-data-and-matching §4): it starts from
 * each shard's snapshot, then reads the streams with `XREAD BLOCK`. Whenever a shard's `seq` is
 * not the next one (a restarted writer, a trimmed stream, or this reader falling behind), it
 * re-reads that shard's snapshot first, so no reader is left on a stale price. Entries that do
 * not parse are dropped and logged. apps/realtime and apps/api both read prices through it.
 */
export function followTickStreams(options: TickStreamFollowerOptions): TickStreamFollower {
  const { client, onQuotes } = options;
  const log = options.log ?? { warn: () => undefined };
  const streamKey = options.streamKey ?? tickStreamKey;
  const snapshotKey = options.snapshotKey ?? quoteSnapshotKey;
  const blockMs = options.blockMs ?? 5_000;
  const shards = Array.from({ length: options.shards }, (_, shard) => shard);
  const emit = (quotes: readonly Quote[]) => {
    if (quotes.length > 0) onQuotes(quotes);
  };
  let closed = false;

  /** Per shard: the stream id read up to, and the `seq` last applied (null: resync next). */
  const cursor = new Map(shards.map((shard) => [shard, { id: '$', seq: null as number | null }]));

  async function resync(shard: number): Promise<void> {
    const rows = await client.hvals(snapshotKey(shard));
    const quotes: Quote[] = [];
    let dropped = 0;
    for (const row of rows) {
      const parsed = Quote.safeParse(safeJson(row));
      if (parsed.success) quotes.push(parsed.data);
      else dropped += 1;
    }
    if (dropped > 0) log.warn('Dropped unparseable snapshot rows', { shard, dropped });
    emit(quotes);
  }

  async function start(): Promise<void> {
    // The newest entry id first, so nothing written between the snapshot and the first read is lost.
    for (const shard of shards) {
      const [last] = await client.xrevrange(streamKey(shard), '+', '-', 'COUNT', 1);
      const position = cursor.get(shard);
      if (position) position.id = last?.[0] ?? '0-0';
      await resync(shard);
      const entry = last ? parseEntry(last[1]) : null;
      if (position && entry) position.seq = entry.seq;
    }
  }

  /** One `XREAD BLOCK` and the entries it returned. */
  async function step(): Promise<void> {
    const read = (await client.xread(
      'COUNT',
      100,
      'BLOCK',
      blockMs,
      'STREAMS',
      ...shards.map(streamKey),
      ...shards.map((shard) => cursor.get(shard)?.id ?? '$'),
    )) as [string, TickStreamRecord[]][] | null;
    for (const [key, entries] of read ?? []) {
      const shard = shards.find((candidate) => streamKey(candidate) === key);
      const position = shard === undefined ? undefined : cursor.get(shard);
      if (shard === undefined || !position) continue;
      for (const [id, fields] of entries) {
        position.id = id;
        const entry = parseEntry(fields);
        if (!entry) {
          log.warn('Dropped a malformed tick stream entry', { shard });
          continue;
        }
        try {
          if (tickStreamStep(position.seq, entry) === 'resync') await resync(shard);
          position.seq = entry.seq;
          emit(entry.quotes);
        } catch (error) {
          // This entry is consumed, so the next one must re-read the snapshot.
          position.seq = null;
          throw error;
        }
      }
    }
  }

  let wake: () => void = () => undefined;
  /** Waits `ms`, or less when `close()` is called. */
  const sleep = (ms: number) =>
    new Promise<void>((resolve) => {
      const timer = timers.setTimeout(resolve, ms);
      wake = () => {
        timers.clearTimeout(timer);
        resolve();
      };
    });

  let markReady: () => void = () => undefined;
  const ready = new Promise<void>((resolve) => {
    markReady = resolve;
  });

  let markClosed: () => void = () => undefined;
  const closing = new Promise<void>((resolve) => {
    markClosed = resolve;
  });
  /** A call into the client that `close()` ends at once, even if the client never answers. */
  const unlessClosed = (call: Promise<void>): Promise<void> => {
    call.catch(() => undefined);
    return Promise.race([call, closing]);
  };

  async function run(): Promise<void> {
    let started = false;
    let failures = 0;
    while (!closed) {
      try {
        if (!started) {
          await unlessClosed(start());
          if (closed) break;
          started = true;
          markReady();
        }
        await unlessClosed(step());
        if (closed) break;
        if (failures > 0) {
          failures = 0;
          log.info?.('Following the tick streams again');
        }
      } catch (error) {
        if (closed) break;
        // Logged once per outage; the retries after it stay quiet.
        if (failures === 0) {
          const message = started
            ? 'Reading the tick stream failed'
            : 'Starting the tick streams failed';
          log.warn(message, { error: String(error) });
        }
        failures += 1;
        await sleep(Math.min(RETRY_MS * 2 ** (failures - 1), MAX_RETRY_MS));
      }
    }
    markReady();
  }

  const running = run();

  return {
    ready: () => ready,
    async close() {
      closed = true;
      markClosed();
      wake();
      client.disconnect();
      await running;
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

/** The `batch` field of a stream entry, parsed; null when it is missing or malformed. */
function parseEntry(fields: readonly string[]): TickStreamEntry | null {
  const at = fields.indexOf('batch');
  const parsed = TickStreamEntry.safeParse(at < 0 ? undefined : safeJson(fields[at + 1] ?? ''));
  return parsed.success ? parsed.data : null;
}
