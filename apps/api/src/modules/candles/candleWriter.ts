import { TickStreamEntry, tickStreamKey } from '@nthstock/contracts';
import { systemClock, type Clock } from '@nthstock/utils';
import type { Redis } from 'ioredis';
import {
  MINUTE_MS,
  bucketOf,
  createMinuteAggregator,
  minuteOf,
  type ClosedMinute,
  type MinuteAggregator,
} from './minuteAggregator.js';
import type { CandleStore, StoredBar } from './store.js';

/** The candle writer's consumer group on every tick stream (spec market-data-and-matching §7.2). */
const CANDLES_GROUP = 'candles';
/** One writer process reads every shard; a fixed name keeps its pending entries across restarts. */
const CANDLES_CONSUMER = 'candle-writer';

/** The last minute written for a shard (minutes since the epoch), so a restart does not redo it. */
const candlesWrittenKey = (shard: number): string => `nthstock:candles:written:v1:${String(shard)}`;

/** A minute is written without waiting for a silent shard once it ended this long ago. */
const DEFAULT_IDLE_GRACE_MS = 5_000;

export type CandleWriterLog = {
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
};

export type CandleWriterOptions = {
  /** A connection of the writer's own (it blocks on XREADGROUP); `close()` disconnects it. */
  redis: Redis;
  store: Pick<CandleStore, 'upsertMinuteBars'>;
  /** How many shards apps/quotes writes (`SHARDS`); the writer reads every one. */
  shards: number;
  /** Key and group names; tests pass their own so suites can share one Redis. */
  streamKey?: (shard: number) => string;
  writtenKey?: (shard: number) => string;
  group?: string;
  consumer?: string;
  /** Wall-clock time for the idle flush only; bars themselves follow the quotes' `ts`. */
  clock?: Clock;
  idleGraceMs?: number;
  /** How long one `XREADGROUP BLOCK` waits (also how often the idle flush is checked). */
  blockMs?: number;
  /** Entries per stream per read. */
  count?: number;
  log?: CandleWriterLog;
};

export type CandleWriter = {
  /** Resolves once the pending entries are replayed and the writer reads new ones (or on close). */
  ready(): Promise<void>;
  /** Stops at once, as a crash would: forming bars are dropped and rebuilt by the next start. */
  close(): Promise<void>;
};

/**
 * A stream entry as ioredis's `xreadgroup` returns it (one `[key, entries]` pair per stream;
 * `redis.call` would hand back RESP3's flat map instead). The fields are null for an entry
 * trimmed away while pending.
 */
type StreamRecord = [id: string, fields: string[] | null];
type ReadReply = [key: string, entries: StreamRecord[]][] | null;

type ShardState = {
  shard: number;
  key: string;
  aggregator: MinuteAggregator;
  /** The last minute written (from Redis at start), or null before the first. */
  written: number | null;
  /** Entry ids read and not yet acknowledged, by the minute of their newest quote. */
  entries: Map<number, string[]>;
  /** The last read returned nothing for this shard. */
  idle: boolean;
  lastSeq: number | null;
};

const RETRY_MS = 500;
const MAX_RETRY_MS = 10_000;
/** Malformed or trimmed entries: acknowledged with the next minute written. */
const NO_MINUTE = Number.NEGATIVE_INFINITY;

/**
 * Writes 1-minute bars from the tick streams (spec market-data-and-matching §7.2). It reads every
 * shard's stream in its own consumer group, folds the quotes into the forming bar per token, and
 * when a minute closes on every shard (stream time moved past it, or the shard is silent and the
 * minute ended `idleGraceMs` ago) writes that minute's bars in one `upsertMinuteBars` call.
 *
 * Restart safety: after writing minute M it records M in `writtenKey(shard)`, then acknowledges
 * the entries of minutes before M. The entries of M stay pending, so that a restart, which first
 * replays the pending entries, has each token's cumulative volume before M+1 as its baseline.
 * Pending entries of minutes up to the recorded one only move baselines; later ones form bars and
 * are written again. A crash between the INSERT and the SET rewrites that minute with the same
 * values, which the upsert overwrites.
 */
export function startCandleWriter(options: CandleWriterOptions): CandleWriter {
  const { redis, store } = options;
  const streamKey = options.streamKey ?? tickStreamKey;
  const writtenKey = options.writtenKey ?? candlesWrittenKey;
  const group = options.group ?? CANDLES_GROUP;
  const consumer = options.consumer ?? CANDLES_CONSUMER;
  const clock = options.clock ?? systemClock;
  const idleGraceMs = options.idleGraceMs ?? DEFAULT_IDLE_GRACE_MS;
  const blockMs = options.blockMs ?? 1_000;
  const count = options.count ?? 500;
  const log = options.log ?? { info: () => undefined, warn: () => undefined };
  const shardNumbers = Array.from({ length: options.shards }, (_, shard) => shard);

  let states: ShardState[] = [];
  /** Closed bars by minute, waiting for the other shards to close the same minute. */
  let closedBars = new Map<number, StoredBar[]>();
  let stopped = false;

  const addClosed = (closed: ClosedMinute | null) => {
    if (!closed) return;
    const bars = closedBars.get(closed.minute);
    if (bars) bars.push(...closed.bars);
    else closedBars.set(closed.minute, closed.bars);
  };

  const track = (state: ShardState, minute: number, id: string) => {
    const ids = state.entries.get(minute);
    if (ids) ids.push(id);
    else state.entries.set(minute, [id]);
  };

  /** Folds one entry: into bars, or (a minute already written) into volume baselines only. */
  const fold = (state: ShardState, [id, fields]: StreamRecord) => {
    const entry = parseEntry(fields);
    if (!entry) {
      log.warn('Skipped a malformed or trimmed tick stream entry', { shard: state.shard, id });
      track(state, NO_MINUTE, id);
      return;
    }
    if (state.lastSeq !== null && entry.seq !== state.lastSeq + 1) {
      log.warn('Tick stream entries were missed or the quote service restarted', {
        shard: state.shard,
        after: state.lastSeq,
        seq: entry.seq,
      });
    }
    state.lastSeq = entry.seq;
    const minute = Math.max(...entry.quotes.map(minuteOf));
    if (state.written !== null && minute <= state.written) {
      for (const quote of entry.quotes) state.aggregator.observe(quote);
    } else {
      for (const quote of entry.quotes) addClosed(state.aggregator.add(quote));
    }
    track(state, minute, id);
  };

  /** This consumer's pending entries of one stream after `id` (already delivered, not acked). */
  const readPending = async (key: string, id: string) =>
    (await redis.xreadgroup(
      'GROUP',
      group,
      consumer,
      'COUNT',
      count,
      'STREAMS',
      key,
      id,
    )) as ReadReply;

  /** Creates the groups, reads the written minutes and replays this consumer's pending entries. */
  async function setUp(): Promise<void> {
    for (const shard of shardNumbers) {
      try {
        await redis.xgroup('CREATE', streamKey(shard), group, '0', 'MKSTREAM');
      } catch (error) {
        if (!String(error).includes('BUSYGROUP')) throw error;
      }
    }
    const written = await redis.mget(...shardNumbers.map(writtenKey));
    const fresh = shardNumbers.map((shard): ShardState => {
      const value = written[shard];
      const minute = value == null ? null : Number.parseInt(value, 10);
      const recorded = minute !== null && Number.isSafeInteger(minute) ? minute : null;
      return {
        shard,
        key: streamKey(shard),
        aggregator: createMinuteAggregator({ closedThrough: recorded }),
        written: recorded,
        entries: new Map(),
        idle: false,
        lastSeq: null,
      };
    });
    // A failed start retries from scratch, so nothing is folded twice.
    states = fresh;
    closedBars = new Map();
    let replayed = 0;
    for (const state of fresh) {
      let cursor = '0';
      for (;;) {
        const reply = await readPending(state.key, cursor);
        const entries = reply?.[0]?.[1] ?? [];
        if (entries.length === 0) break;
        for (const record of entries) fold(state, record);
        replayed += entries.length;
        cursor = entries[entries.length - 1]?.[0] ?? cursor;
      }
    }
    log.info('Candle writer started', {
      shards: shardNumbers.length,
      written: fresh.map((state) => state.written),
      replayed,
    });
  }

  /** One blocking read of new entries on every shard. */
  async function readNew(): Promise<void> {
    const reply = (await redis.xreadgroup(
      'GROUP',
      group,
      consumer,
      'COUNT',
      count,
      'BLOCK',
      blockMs,
      'STREAMS',
      ...states.map((state) => state.key),
      ...states.map(() => '>'),
    )) as ReadReply;
    const seen = new Set<string>();
    for (const [key, entries] of reply ?? []) {
      const state = states.find((candidate) => candidate.key === key);
      if (!state) continue;
      if (entries.length > 0) seen.add(key);
      for (const record of entries) fold(state, record);
    }
    for (const state of states) state.idle = !seen.has(state.key);
  }

  /** Writes every minute that has closed on all shards, oldest first, one upsert per minute. */
  async function flush(): Promise<void> {
    for (;;) {
      const now = clock.now().getTime();
      const timeUp = (minute: number) => now >= (minute + 1) * MINUTE_MS + idleGraceMs;
      const candidates = [...closedBars.keys()];
      for (const state of states) {
        const forming = state.aggregator.formingMinute();
        if (state.idle && forming !== null && timeUp(forming)) candidates.push(forming);
      }
      if (candidates.length === 0) return;
      const minute = Math.min(...candidates);
      const ready = states.every((state) => {
        const before = state.aggregator.closedBefore();
        return (before !== null && before > minute) || (state.idle && timeUp(minute));
      });
      if (!ready) return;
      for (const state of states) {
        const forming = state.aggregator.formingMinute();
        if (forming !== null && forming <= minute) addClosed(state.aggregator.close());
      }
      const bars = closedBars.get(minute) ?? [];
      await store.upsertMinuteBars(bars);
      if (stopped) return;
      const marked = await shardNumbers
        .reduce((multi, shard) => multi.set(writtenKey(shard), String(minute)), redis.multi())
        .exec();
      const failed = marked?.find(([error]) => error !== null)?.[0];
      if (!marked || failed) throw failed ?? new Error('The written minute was not recorded');
      closedBars.delete(minute);
      log.info('Wrote candles', { bucket: bucketOf(minute).toISOString(), bars: bars.length });
      for (const state of states) {
        state.written = minute;
        state.aggregator.closeThrough(minute);
        const done = [...state.entries.keys()].filter((at) => at < minute);
        const ids = done.flatMap((at) => state.entries.get(at) ?? []);
        if (ids.length > 0) await redis.xack(state.key, group, ...ids);
        for (const at of done) state.entries.delete(at);
      }
    }
  }

  let markReady: () => void = () => undefined;
  const ready = new Promise<void>((resolve) => {
    markReady = resolve;
  });
  let markClosed: () => void = () => undefined;
  const closing = new Promise<void>((resolve) => {
    markClosed = resolve;
  });
  /** A call that `close()` ends at once, even if Redis or Postgres never answers. */
  const unlessClosed = (call: Promise<void>): Promise<void> => {
    call.catch(() => undefined);
    return Promise.race([call, closing]);
  };
  let wake: () => void = () => undefined;
  const sleep = (ms: number) =>
    new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, ms);
      wake = () => {
        clearTimeout(timer);
        resolve();
      };
    });

  async function run(): Promise<void> {
    let started = false;
    let failures = 0;
    while (!stopped) {
      try {
        if (!started) {
          await unlessClosed(setUp());
          if (stopped) break;
          started = true;
          markReady();
        }
        await unlessClosed(flush());
        if (stopped) break;
        await unlessClosed(readNew());
        if (stopped) break;
        await unlessClosed(flush());
        if (failures > 0) {
          failures = 0;
          log.info('Candle writer recovered');
        }
      } catch (error) {
        if (stopped) break;
        // Logged once per outage; closed bars stay in memory and are written on recovery.
        if (failures === 0) log.warn('Candle writer failed; retrying', { error: String(error) });
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
      stopped = true;
      markClosed();
      wake();
      redis.disconnect();
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

/** The `batch` field of a stream entry, parsed; null when it is missing, trimmed or malformed. */
function parseEntry(fields: readonly string[] | null): TickStreamEntry | null {
  if (!fields) return null;
  const at = fields.indexOf('batch');
  const parsed = TickStreamEntry.safeParse(at < 0 ? undefined : safeJson(fields[at + 1] ?? ''));
  return parsed.success ? parsed.data : null;
}
