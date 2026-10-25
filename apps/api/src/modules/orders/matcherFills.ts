import { MATCHER_FILLS_GROUP, MatcherFill, matcherFillsKey } from '@nthstock/contracts';
import type { PublisherLog } from '../../ticks/publisher.js';
import type { OrderService } from './service.js';

/**
 * The Redis client the fill reader uses (`XGROUP`, `XREADGROUP`, `XAUTOCLAIM`, `XACK` through
 * `call`); an ioredis client fits it. `XREADGROUP BLOCK` holds it, so give it its own connection.
 */
export type FillStreamClient = {
  call(command: string, ...args: (string | number)[]): Promise<unknown>;
  disconnect(): void;
};

export type MatcherFills = {
  /** Resolves once the groups exist and the first read waits, or when it is closed first. */
  ready(): Promise<void>;
  /** Stops reading and disconnects the client. */
  close(): Promise<void>;
};

type StreamRecord = [id: string, fields: string[]];

const RETRY_MS = 500;
const MAX_RETRY_MS = 10_000;
/** A fill a process took and did not ack in this long (it crashed) is taken by another. */
export const FILL_CLAIM_IDLE_MS = 30_000;

/**
 * Commits the matcher's fill requests (ADR 0013, NSTOCK-0367). Every apps/api process reads the
 * fill streams of all shards in one consumer group, so each request goes to one process, which
 * runs it through `applyMatcherFill` (the account store, its version check and audit entries, then
 * the order updates) and acks it only after the commit. A request a crashed process held is
 * claimed after `claimIdleMs`, so none is lost; running one twice fills nothing twice. Requests of
 * one user run in order; different users run side by side.
 */
export function startMatcherFills(options: {
  orders: Pick<OrderService, 'applyMatcherFill'>;
  client: FillStreamClient;
  shards: number;
  /** This process's name in the group: unique per process. */
  consumer: string;
  log: PublisherLog;
  /** Tests pass shorter waits and their own keys. */
  blockMs?: number;
  claimIdleMs?: number;
  fillsKey?: (shard: number) => string;
}): MatcherFills {
  const { orders, client, consumer, log } = options;
  const keyOf = options.fillsKey ?? matcherFillsKey;
  const keys = Array.from({ length: options.shards }, (_, shard) => keyOf(shard));
  const blockMs = options.blockMs ?? 5_000;
  const claimIdleMs = options.claimIdleMs ?? FILL_CLAIM_IDLE_MS;
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

  /** Runs the entries, each user's in order, and acks each one that committed. */
  async function handle(key: string, entries: readonly StreamRecord[]): Promise<void> {
    const byUser = new Map<string, { id: string; fill: MatcherFill }[]>();
    const malformed: string[] = [];
    for (const [id, fields] of entries) {
      const fill = parseFill(fields);
      if (!fill) {
        malformed.push(id);
        continue;
      }
      const queue = byUser.get(fill.userId) ?? [];
      queue.push({ id, fill });
      byUser.set(fill.userId, queue);
    }
    if (malformed.length > 0) {
      log.warn(`Dropped ${String(malformed.length)} malformed matcher fill(s) on ${key}`);
      await client.call('XACK', key, group, ...malformed);
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
              `Matcher fill for ${fill.userId} failed: ${error instanceof Error ? error.message : String(error)}`,
            );
            return;
          }
          await client.call('XACK', key, group, id);
        }
      }),
    );
  }

  let lastClaim = 0;
  /** Takes over requests another process read and did not ack within `claimIdleMs`. */
  async function claim(): Promise<void> {
    const now = Date.now();
    if (now - lastClaim < claimIdleMs) return;
    lastClaim = now;
    for (const key of keys) {
      const claimed = (await client.call(
        'XAUTOCLAIM',
        key,
        group,
        consumer,
        claimIdleMs,
        '0-0',
        'COUNT',
        100,
      )) as [string, StreamRecord[], ...unknown[]] | null;
      // Entries trimmed from the stream come back as null records; there is nothing to run.
      const entries = (claimed?.[1] ?? []).filter(
        (entry): entry is StreamRecord => Array.isArray(entry) && Array.isArray(entry[1]),
      );
      if (entries.length > 0) await handle(key, entries);
    }
  }

  async function step(): Promise<void> {
    await claim();
    const reading = client.call(
      'XREADGROUP',
      'GROUP',
      group,
      consumer,
      'COUNT',
      100,
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
        const message = error instanceof Error ? error.message : String(error);
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

/** The `fill` field of a stream entry, parsed; null when it is missing or malformed. */
function parseFill(fields: readonly string[]): MatcherFill | null {
  const at = fields.indexOf('fill');
  if (at < 0) return null;
  try {
    const parsed = MatcherFill.safeParse(JSON.parse(fields[at + 1] ?? ''));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
