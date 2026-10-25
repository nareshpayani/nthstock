import { MatcherCommand, matcherCommandsKey } from '@nthstock/contracts';
import type { OrderBook } from '@nthstock/paperEngine';
import type { MatcherLog } from './matcher.js';

/** The Redis calls the command reader makes; an ioredis client fits it. `XREAD BLOCK` holds it. */
export type CommandStreamClient = {
  xread(...args: (string | number)[]): Promise<unknown>;
  disconnect(): void;
};

export type CommandReader = {
  /** Resolves once the first read is waiting on the stream, or when it is closed first. */
  ready(): Promise<void>;
  /** Stops reading and disconnects the client. */
  close(): Promise<void>;
};

type StreamRecord = [id: string, fields: string[]];

const RETRY_MS = 500;
const MAX_RETRY_MS = 10_000;

/**
 * Applies one command to the instrument's book (spec market-data-and-matching §5.3). The book
 * keeps the version rule: a command older than the entry it holds changes nothing. Returns
 * whether it changed the book.
 */
export function applyCommand(book: OrderBook, command: MatcherCommand): boolean {
  switch (command.type) {
    case 'ADD':
    case 'MODIFY':
      return book.upsertOrder({
        orderId: command.orderId,
        userId: command.userId,
        version: command.version,
        side: command.side,
        price: command.price,
      });
    case 'CANCEL':
      return book.removeOrder(command.orderId, command.version);
    case 'STOP_ADD':
      return book.upsertStop({
        stopId: command.stopId,
        userId: command.userId,
        version: command.version,
        state: command.state,
      });
    case 'STOP_CANCEL':
      return book.removeStop(command.stopId, command.version);
  }
}

/**
 * Reads the shard's command stream (NSTOCK-0365) with `XREAD BLOCK` from the newest entry on, and
 * hands each command that parses to `onCommand`. A malformed entry is dropped and logged; a
 * failed read is logged once per outage and retried with backoff. Commands written while this
 * process was down are not replayed: the reconcile loop (NSTOCK-0366) loads the book from
 * Postgres, which is the truth.
 */
export function readMatcherCommands(options: {
  client: CommandStreamClient;
  shard: number;
  onCommand: (command: MatcherCommand) => void;
  log: MatcherLog;
  /** Tests pass shorter reads and their own key. */
  blockMs?: number;
  commandsKey?: (shard: number) => string;
}): CommandReader {
  const { client, shard, onCommand, log } = options;
  const key = (options.commandsKey ?? matcherCommandsKey)(shard);
  const blockMs = options.blockMs ?? 5_000;
  let cursor = '$';
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

  async function step(): Promise<void> {
    const reading = client.xread('COUNT', 500, 'BLOCK', blockMs, 'STREAMS', key, cursor);
    // The first read is in flight: anything written from here on is read.
    markReady();
    reading.catch(() => undefined);
    const read = (await Promise.race([reading, closing])) as [string, StreamRecord[]][] | null;
    if (closed) return;
    for (const [, entries] of read ?? []) {
      for (const [id, fields] of entries) {
        cursor = id;
        const command = parseCommand(fields);
        if (!command) {
          log.warn('Dropped a malformed matcher command', { shard, id });
          continue;
        }
        try {
          onCommand(command);
        } catch (error) {
          // Drop only this entry: the cursor has moved on, so the rest of the batch must still run.
          log.warn('Dropped a matcher command that failed to apply', {
            shard,
            id,
            type: command.type,
            ...('orderId' in command ? { orderId: command.orderId } : {}),
            error: String(error),
          });
        }
      }
    }
  }

  async function run(): Promise<void> {
    let failures = 0;
    while (!closed) {
      try {
        await step();
        if (failures > 0) log.info('Reading matcher commands again', { shard });
        failures = 0;
      } catch (error) {
        if (closed) break;
        if (failures === 0)
          log.warn('Reading matcher commands failed', { shard, error: String(error) });
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

/** The `command` field of a stream entry, parsed; null when it is missing or malformed. */
function parseCommand(fields: readonly string[]): MatcherCommand | null {
  const at = fields.indexOf('command');
  if (at < 0) return null;
  try {
    const parsed = MatcherCommand.safeParse(JSON.parse(fields[at + 1] ?? ''));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
