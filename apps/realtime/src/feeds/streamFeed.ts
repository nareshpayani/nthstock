import {
  Quote,
  TickStreamEntry,
  quoteSnapshotKey,
  tickStreamKey,
  tickStreamStep,
} from '@nthstock/contracts';
import { Redis } from 'ioredis';
import { silentLogger, type Logger } from '../logger.js';
import type { QuoteFeed, QuoteListener } from './feed.js';

export type RedisStreamQuoteFeed = QuoteFeed & {
  /** Resolves once the feed has read the snapshots and is waiting on the streams. */
  ready(): Promise<void>;
};

export type RedisStreamQuoteFeedOptions = {
  url: string;
  /** How many shards apps/quotes writes (`SHARDS`); the feed reads every one. */
  shards: number;
  /** Key names for a shard; tests pass their own so suites can share one Redis. */
  streamKey?: (shard: number) => string;
  snapshotKey?: (shard: number) => string;
  /** How long one `XREAD BLOCK` waits before it reads again; default 5 s. */
  blockMs?: number;
  logger?: Logger;
};

/**
 * Reads the tick streams apps/quotes writes (spec market-data-and-matching §4, NSTOCK-0353), in
 * place of the pub/sub tick channel. It starts from each shard's snapshot, then follows the
 * streams with `XREAD BLOCK`. Whenever a shard's `seq` is not the next one (a restarted writer,
 * a trimmed stream, or this feed falling behind), it re-reads that shard's snapshot first, so no
 * subscriber is left on a stale price. Entries that do not parse are dropped and logged.
 */
export function createRedisStreamQuoteFeed(
  options: RedisStreamQuoteFeedOptions,
): RedisStreamQuoteFeed {
  const logger = options.logger ?? silentLogger;
  const streamKey = options.streamKey ?? tickStreamKey;
  const snapshotKey = options.snapshotKey ?? quoteSnapshotKey;
  const blockMs = options.blockMs ?? 5_000;
  const shards = Array.from({ length: options.shards }, (_, shard) => shard);
  const listeners = new Set<QuoteListener>();
  const emit = (quotes: readonly Quote[]) => {
    if (quotes.length === 0) return;
    for (const listener of [...listeners]) listener(quotes);
  };
  // XREAD BLOCK holds its connection, so it gets one of its own.
  const client = new Redis(options.url, { maxRetriesPerRequest: null });
  let closed = false;
  let down = false;
  client.on('error', (error: Error) => {
    if (down) return;
    down = true;
    logger.warn('Redis tick stream unavailable', { error: error.message });
  });
  client.on('ready', () => {
    if (down) logger.info('Redis tick stream reconnected');
    down = false;
  });

  /** Per shard: the stream id read up to, and the `seq` last applied (null: resync next). */
  const cursor = new Map(shards.map((shard) => [shard, { id: '$', seq: null as number | null }]));

  async function resync(shard: number): Promise<void> {
    const rows = await client.hvals(snapshotKey(shard));
    const quotes: Quote[] = [];
    for (const row of rows) {
      const parsed = Quote.safeParse(safeJson(row));
      if (parsed.success) quotes.push(parsed.data);
    }
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

  async function follow(): Promise<void> {
    while (!closed) {
      let read: [string, [string, string[]][]][] | null;
      try {
        read = (await client.xread(
          'COUNT',
          100,
          'BLOCK',
          blockMs,
          'STREAMS',
          ...shards.map(streamKey),
          ...shards.map((shard) => cursor.get(shard)?.id ?? '$'),
        )) as [string, [string, string[]][]][] | null;
      } catch (error) {
        if (closed) return;
        logger.warn('Reading the tick stream failed', { error: String(error) });
        await new Promise((resolve) => setTimeout(resolve, 500));
        continue;
      }
      for (const [key, entries] of read ?? []) {
        const shard = shards.find((candidate) => streamKey(candidate) === key);
        const position = shard === undefined ? undefined : cursor.get(shard);
        if (shard === undefined || !position) continue;
        for (const [id, fields] of entries) {
          position.id = id;
          const entry = parseEntry(fields);
          if (!entry) {
            logger.warn('Dropped a malformed tick stream entry', { shard });
            continue;
          }
          if (tickStreamStep(position.seq, entry) === 'resync') await resync(shard);
          position.seq = entry.seq;
          emit(entry.quotes);
        }
      }
    }
  }

  const started = start();
  // A failed start surfaces through ready(); the 'error' handler logs the outage.
  started.catch(() => undefined);
  const following = started.then(follow, () => undefined);

  return {
    onQuotes(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    ready: () => started,
    async close() {
      closed = true;
      listeners.clear();
      client.disconnect();
      await following;
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
