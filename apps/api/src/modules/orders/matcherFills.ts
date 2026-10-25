import type { EventEmitter } from 'node:events';
import {
  MATCHER_FILLS_DEAD_KEY,
  MATCHER_FILLS_DEAD_MAXLEN,
  MATCHER_FILLS_GROUP,
  MatcherFill,
  matcherFillsKey,
} from '@nthstock/contracts';
import type { PublisherLog } from '../../ticks/publisher.js';
import type { OrderService } from './service.js';

/**
 * The Redis client the fill reader uses (`XGROUP`, `XREADGROUP`, `XAUTOCLAIM`, `XPENDING`, `XACK`,
 * `XADD` through `call`); an ioredis client fits it. `XREADGROUP BLOCK` holds it, so give it its
 * own connection.
 */
export type FillStreamClient = {
  call(command: string, ...args: (string | number)[]): Promise<unknown>;
  disconnect(): void;
};

export type MatcherFills = {
  /** Resolves once the groups exist and the first read waits, or when it is closed first. */
  ready(): Promise<void>;
  /**
   * Stops reading, waits for the fills in flight and their acks (up to `closeGraceMs`), then
   * disconnects the client and removes this consumer from the groups when it holds nothing.
   */
  close(): Promise<void>;
};

type StreamRecord = [id: string, fields: string[]];

const RETRY_MS = 500;
const MAX_RETRY_MS = 10_000;
/** A fill a process took and did not ack in this long (it crashed) is taken by another. */
const FILL_CLAIM_IDLE_MS = 30_000;
/**
 * A request delivered more than this many times without committing goes to the dead-letter
 * stream (NSTOCK-0388): with a 30 s claim, about two and a half minutes of retries.
 */
const FILL_MAX_DELIVERIES = 5;
/** `XAUTOCLAIM` pages one claim round follows at most, so new fills are not starved. */
const MAX_CLAIM_PAGES = 50;
const CLAIM_COUNT = 100;
/** How long `close()` waits for the fills in flight before it disconnects anyway. */
const CLOSE_GRACE_MS = 5_000;
/** The fill client's Redis `error` events are logged at most once in this long. */
const FILL_CLIENT_LOG_EVERY_MS = 60_000;

/**
 * Commits the matcher's fill requests (ADR 0013, NSTOCK-0367). Every apps/api process reads the
 * fill streams of all shards in one consumer group, so each request goes to one process, which
 * runs it through `applyMatcherFill` (the account store, its version check and audit entries, then
 * the order updates) and acks it only after the commit. A request a crashed process held is
 * claimed after `claimIdleMs`, so none is lost; running one twice fills nothing twice. Requests of
 * one user run in order; different users run side by side.
 *
 * Hardening (NSTOCK-0388): each entry's failure (the fill, its ack) is its own, so one cannot
 * reject the batch. A claim round follows the `XAUTOCLAIM` cursor through the whole pending list.
 * A malformed entry, or one delivered more than `maxDeliveries` times, is copied to the
 * dead-letter stream and acked: Postgres still has the order open, so the matcher's reconcile puts
 * it back on its book and the next crossing tick asks again.
 */
export function startMatcherFills(options: {
  orders: Pick<OrderService, 'applyMatcherFill'>;
  client: FillStreamClient;
  shards: number;
  /** This process's name in the group: unique per process. */
  consumer: string;
  log: PublisherLog;
  /**
   * Another connection, which `close()` uses to remove this consumer from the groups once the
   * reader's own is closed (its `XREADGROUP BLOCK` may still hold it). Left out, it stays.
   */
  cleanup?: Pick<FillStreamClient, 'call'>;
  /** Tests pass shorter waits, their own keys and a manual clock. */
  blockMs?: number;
  claimIdleMs?: number;
  maxDeliveries?: number;
  closeGraceMs?: number;
  fillsKey?: (shard: number) => string;
  deadLetterKey?: string;
  now?: () => number;
}): MatcherFills {
  const { orders, client, consumer, log } = options;
  const keyOf = options.fillsKey ?? matcherFillsKey;
  const keys = Array.from({ length: options.shards }, (_, shard) => keyOf(shard));
  const blockMs = options.blockMs ?? 5_000;
  const claimIdleMs = options.claimIdleMs ?? FILL_CLAIM_IDLE_MS;
  const maxDeliveries = options.maxDeliveries ?? FILL_MAX_DELIVERIES;
  const deadKey = options.deadLetterKey ?? MATCHER_FILLS_DEAD_KEY;
  const now = options.now ?? Date.now;
  const group = MATCHER_FILLS_GROUP;
  let closed = false;

  let markReady: () => void = () => undefined;
  const ready = new Promise<void>((resolve) => {
    markReady = resolve;
  });
  let markClosed: () => void = () => undefined;
  const closing = new Promise<void>((resolve) => {
    markClosed = resolve;
  });
  let wake: () => void = () => undefined;
  const sleep = (ms: number) =>
    new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, ms);
      wake = () => {
        clearTimeout(timer);
        resolve();
      };
    });
  /** A client call that `close()` ends at once, even if the client never answers. */
  const unlessClosed = <T>(call: Promise<T>): Promise<T | undefined> => {
    call.catch(() => undefined);
    return Promise.race([call, closing.then(() => undefined)]);
  };

  async function createGroups(): Promise<void> {
    for (const key of keys) {
      try {
        // From the stream's start, so requests written before the first process came up count.
        await client.call('XGROUP', 'CREATE', key, group, '0', 'MKSTREAM');
      } catch (error) {
        if (!String(error).includes('BUSYGROUP')) throw error;
      }
    }
  }

  /** Acks one entry; a failure leaves it pending, to be claimed and run again (a no-op then). */
  async function ack(key: string, id: string): Promise<boolean> {
    try {
      await client.call('XACK', key, group, id);
      return true;
    } catch (error) {
      log.warn(`Acking matcher fill ${id} on ${key} failed: ${messageOf(error)}`);
      return false;
    }
  }

  /** Copies an entry to the dead-letter stream, then acks it; a failure leaves it pending. */
  async function deadLetter(
    key: string,
    id: string,
    fields: readonly string[],
    reason: string,
  ): Promise<void> {
    try {
      await client.call(
        'XADD',
        deadKey,
        'MAXLEN',
        '~',
        MATCHER_FILLS_DEAD_MAXLEN,
        '*',
        'source',
        key,
        'id',
        id,
        'reason',
        reason,
        'fill',
        fieldOf(fields, 'fill') ?? '',
      );
    } catch (error) {
      log.warn(`Dead-lettering matcher fill ${id} on ${key} failed: ${messageOf(error)}`);
      return;
    }
    await ack(key, id);
  }

  /**
   * Runs the entries, each user's in order, and acks each one that committed. `deliveries` holds
   * how often each claimed entry was delivered; a fresh read is a first delivery.
   */
  async function handle(
    key: string,
    entries: readonly StreamRecord[],
    deliveries: ReadonlyMap<string, number> = new Map(),
  ): Promise<void> {
    const byUser = new Map<string, { id: string; fill: MatcherFill }[]>();
    for (const [id, fields] of entries) {
      const parsed = parseFill(fields);
      if (!parsed.ok) {
        log.warn(
          `Dead-lettered malformed matcher fill ${id} on ${key} (user ${parsed.userId ?? 'unknown'}): ${parsed.reason}`,
        );
        await deadLetter(key, id, fields, `malformed: ${parsed.reason}`);
        continue;
      }
      const delivered = deliveries.get(id) ?? 1;
      if (delivered > maxDeliveries) {
        const { userId, orderIds, stopIds } = parsed.fill;
        log.warn(
          `Dead-lettered matcher fill ${id} on ${key} for ${userId} after ${String(delivered - 1)} deliveries (orders ${orderIds.join(',') || '-'}, stops ${stopIds.join(',') || '-'})`,
        );
        await deadLetter(key, id, fields, `delivered ${String(delivered - 1)} times`);
        continue;
      }
      const queue = byUser.get(parsed.fill.userId) ?? [];
      queue.push({ id, fill: parsed.fill });
      byUser.set(parsed.fill.userId, queue);
    }
    await Promise.all(
      [...byUser.values()].map(async (queue) => {
        for (const { id, fill } of queue) {
          try {
            await orders.applyMatcherFill(fill);
          } catch (error) {
            // Left pending: it is claimed and run again after `claimIdleMs`. The user's later
            // requests wait for that too, so their fills stay in order.
            log.warn(
              `Matcher fill ${id} on ${key} for ${fill.userId} failed (delivery ${String(deliveries.get(id) ?? 1)} of ${String(maxDeliveries)}): ${messageOf(error)}`,
            );
            return;
          }
          await ack(key, id);
        }
      }),
    );
  }

  /** How often this consumer has had each of `entries` delivered (`XPENDING`, extended form). */
  async function deliveriesOf(
    key: string,
    entries: readonly StreamRecord[],
  ): Promise<Map<string, number>> {
    const first = entries[0]?.[0];
    const last = entries.at(-1)?.[0];
    if (first === undefined || last === undefined) return new Map();
    const pending = await client.call(
      'XPENDING',
      key,
      group,
      first,
      last,
      entries.length + CLAIM_COUNT,
      consumer,
    );
    const counts = new Map<string, number>();
    if (!Array.isArray(pending)) return counts;
    for (const row of pending as unknown[]) {
      if (Array.isArray(row) && typeof row[0] === 'string') counts.set(row[0], Number(row[3]));
    }
    return counts;
  }

  /**
   * The delivery counts, or none when `XPENDING` fails: the entries then run as first deliveries,
   * so a Redis error never pushes a healthy fill toward the dead-letter cap.
   */
  async function deliveriesOrNone(
    key: string,
    entries: readonly StreamRecord[],
  ): Promise<Map<string, number>> {
    try {
      return await deliveriesOf(key, entries);
    } catch (error) {
      log.warn(
        `Could not read delivery counts on ${key}, running the claimed fills: ${messageOf(error)}`,
      );
      return new Map();
    }
  }

  let lastClaim: number | null = null;
  /**
   * Takes over requests another process (or this one, for a fill that failed) read and did not
   * ack within `claimIdleMs`, following the cursor until `0-0` (or `MAX_CLAIM_PAGES`).
   */
  async function claim(): Promise<void> {
    const at = now();
    if (lastClaim !== null && at - lastClaim < claimIdleMs) return;
    lastClaim = at;
    for (const key of keys) {
      let cursor = '0-0';
      for (let page = 0; page < MAX_CLAIM_PAGES && !closed; page += 1) {
        const claimed = (await client.call(
          'XAUTOCLAIM',
          key,
          group,
          consumer,
          claimIdleMs,
          cursor,
          'COUNT',
          CLAIM_COUNT,
        )) as [string, StreamRecord[], ...unknown[]] | null;
        // Entries trimmed from the stream come back as null records; there is nothing to run.
        const entries = (claimed?.[1] ?? []).filter(
          (entry): entry is StreamRecord => Array.isArray(entry) && Array.isArray(entry[1]),
        );
        if (entries.length > 0) await handle(key, entries, await deliveriesOrNone(key, entries));
        cursor = String(claimed?.[0] ?? '0-0');
        if (cursor === '0-0') break;
      }
    }
  }

  async function step(): Promise<void> {
    await claim();
    if (closed) return;
    const reading = client.call(
      'XREADGROUP',
      'GROUP',
      group,
      consumer,
      'COUNT',
      CLAIM_COUNT,
      'BLOCK',
      blockMs,
      'STREAMS',
      ...keys,
      ...keys.map(() => '>'),
    );
    markReady();
    const read = await unlessClosed(reading);
    if (closed) return;
    for (const [key, entries] of streamsOf(read)) await handle(key, entries);
  }

  async function run(): Promise<void> {
    let started = false;
    let failures = 0;
    let lastMessage = '';
    while (!closed) {
      try {
        if (!started) {
          await unlessClosed(createGroups());
          if (closed) break;
          started = true;
        }
        await step();
        if (failures > 0) log.info('Reading matcher fills again');
        failures = 0;
      } catch (error) {
        if (closed) break;
        const message = messageOf(error);
        // Redis lost the groups (restart without persistence, deleted stream): create them again.
        if (message.includes('NOGROUP')) started = false;
        if (failures === 0 || message !== lastMessage) {
          log.warn(`Reading matcher fills failed: ${message}`);
        }
        lastMessage = message;
        failures += 1;
        await sleep(Math.min(RETRY_MS * 2 ** (failures - 1), MAX_RETRY_MS));
      }
    }
    markReady();
  }

  /**
   * `XGROUP DELCONSUMER` for each stream where this consumer holds nothing pending: deleting a
   * consumer drops its pending entries too, and those must stay for another process to claim.
   */
  async function removeConsumer(cleanup: Pick<FillStreamClient, 'call'>): Promise<void> {
    for (const key of keys) {
      try {
        const pending = await cleanup.call('XPENDING', key, group, '-', '+', 1, consumer);
        if (Array.isArray(pending) && pending.length > 0) continue;
        await cleanup.call('XGROUP', 'DELCONSUMER', key, group, consumer);
      } catch (error) {
        log.warn(
          `Removing matcher fill consumer ${consumer} on ${key} failed: ${messageOf(error)}`,
        );
      }
    }
  }

  const running = run();
  return {
    ready: () => ready,
    async close() {
      closed = true;
      markClosed();
      wake();
      // The fills in flight finish and are acked on the open connection; a Redis that never
      // answers is cut off after the grace period, and their acks fail (they are claimed again).
      let grace: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([
        running,
        new Promise<void>((resolve) => {
          grace = setTimeout(resolve, options.closeGraceMs ?? CLOSE_GRACE_MS);
        }),
      ]);
      clearTimeout(grace);
      client.disconnect();
      await running;
      if (options.cleanup) await removeConsumer(options.cleanup);
    },
  };
}

/**
 * Logs the fill reader's Redis `error` events at most once per `everyMs`, with how many were left
 * out, and its `ready` events: the first, and each after an error (NSTOCK-0388).
 */
export function logFillClientEvents(
  client: Pick<EventEmitter, 'on'>,
  log: PublisherLog,
  options: { everyMs?: number; now?: () => number } = {},
): void {
  const everyMs = options.everyMs ?? FILL_CLIENT_LOG_EVERY_MS;
  const now = options.now ?? Date.now;
  let lastLogged: number | null = null;
  let skipped = 0;
  let down = false;
  let connected = false;
  client.on('error', (error: unknown) => {
    down = true;
    const at = now();
    if (lastLogged !== null && at - lastLogged < everyMs) {
      skipped += 1;
      return;
    }
    const more = skipped > 0 ? ` (${String(skipped)} more since the last line)` : '';
    log.warn(`Matcher fill reader Redis error: ${messageOf(error)}${more}`);
    lastLogged = at;
    skipped = 0;
  });
  client.on('ready', () => {
    if (!connected) log.info('Matcher fill reader Redis ready');
    else if (down) log.info('Matcher fill reader Redis ready again');
    connected = true;
    down = false;
  });
}

/**
 * The streams of an `XREADGROUP` reply through `call`: a list of `[key, entries]` pairs over
 * RESP2, a flat `key, entries, …` list when the connection speaks RESP3 (a map).
 */
export function streamsOf(reply: unknown): [string, StreamRecord[]][] {
  if (!Array.isArray(reply)) return [];
  if (reply.every((item) => Array.isArray(item))) return reply as [string, StreamRecord[]][];
  const pairs: [string, StreamRecord[]][] = [];
  for (let i = 0; i + 1 < reply.length; i += 2) {
    pairs.push([String(reply[i]), reply[i + 1] as StreamRecord[]]);
  }
  return pairs;
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** The value after `name` in a stream entry's flat field list. */
function fieldOf(fields: readonly string[], name: string): string | undefined {
  for (let i = 0; i + 1 < fields.length; i += 2) if (fields[i] === name) return fields[i + 1];
  return undefined;
}

type ParsedFill =
  { ok: true; fill: MatcherFill } | { ok: false; reason: string; userId: string | undefined };

/**
 * The `fill` field of a stream entry, parsed; when it is missing or malformed, why (the Zod
 * issues, never the values) and the user id when one can be read, for the log line.
 */
function parseFill(fields: readonly string[]): ParsedFill {
  const raw = fieldOf(fields, 'fill');
  if (raw === undefined) return { ok: false, reason: 'no fill field', userId: undefined };
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, reason: 'not JSON', userId: undefined };
  }
  const parsed = MatcherFill.safeParse(json);
  if (parsed.success) return { ok: true, fill: parsed.data };
  const userId =
    typeof json === 'object' && json !== null && 'userId' in json && typeof json.userId === 'string'
      ? json.userId
      : undefined;
  const reason = parsed.error.issues
    .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('; ');
  return { ok: false, reason, userId };
}
