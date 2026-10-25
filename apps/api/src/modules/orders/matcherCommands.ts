import {
  MATCHER_COMMANDS_MAXLEN,
  MATCHER_COMMAND_VERSION,
  matcherCommandsKey,
  type MatcherCommand,
  type Order,
} from '@nthstock/contracts';
import { shardOf } from '@nthstock/utils';
import type { PublisherLog } from '../../ticks/publisher.js';
import type { OrderService } from './service.js';

/** The one Redis call the commands need; an ioredis client fits it. */
export type CommandStream = {
  xadd(
    key: string,
    maxlen: 'MAXLEN',
    approximate: '~',
    count: number,
    id: '*',
    field: 'command',
    value: string,
  ): Promise<unknown>;
};

export type MatcherCommands = {
  /** Stops sending. Safe to call more than once. */
  stop(): void;
};

/**
 * The matcher command for a committed order change (spec market-data-and-matching §5.3), or null
 * when the matcher has nothing to do with it. Only a LIMIT order rests on a book: an OPEN one is
 * `ADD`ed when it is new and `MODIFY`d after any change (a modify or a partial fill), and in any
 * other status it is taken off with `CANCEL`. MARKET orders fill on arrival and never rest.
 * The book applies `ADD` and `MODIFY` alike, by version, so a modify in the same millisecond as
 * the placement that is labelled `ADD` still lands correctly.
 */
export function commandFor(userId: string, order: Order, version: number): MatcherCommand | null {
  if (order.type !== 'LIMIT' || order.price === null) return null;
  const base = { v: MATCHER_COMMAND_VERSION, token: order.token, version } as const;
  if (order.status !== 'OPEN') return { ...base, type: 'CANCEL', orderId: order.id };
  const fresh = order.filledQty === 0 && order.updatedAt === order.placedAt;
  return {
    ...base,
    type: fresh ? 'ADD' : 'MODIFY',
    orderId: order.id,
    userId,
    side: order.side,
    price: order.price,
  };
}

/**
 * Sends every committed order change to the matcher (NSTOCK-0365): one entry on the command
 * stream of the instrument's shard, after the commit that made it, as `startOrderUpdatePublisher`
 * publishes the change to the user's socket. A failed send is logged once until sending recovers;
 * the matcher's reconcile loop repairs the book from Postgres within a minute.
 */
export function startMatcherCommands(options: {
  orders: Pick<OrderService, 'onOrderUpdate'>;
  stream: CommandStream;
  /** `QUOTE_SHARDS`: the matcher shards, the same as the quote service's. */
  shards: number;
  /** Key names for a shard; tests pass their own so suites can share one Redis. */
  commandsKey?: (shard: number) => string;
  log: PublisherLog;
}): MatcherCommands {
  const { orders, stream, shards, log } = options;
  const commandsKey = options.commandsKey ?? matcherCommandsKey;
  let failing = false;
  const onSent = () => {
    if (failing) log.info('Matcher commands recovered');
    failing = false;
  };
  const onFailed = (error: unknown) => {
    if (failing) return;
    failing = true;
    log.warn(`Matcher commands failed: ${error instanceof Error ? error.message : String(error)}`);
  };
  const stop = orders.onOrderUpdate((userId, order, version, last = true) => {
    // Updates of one order in one commit share its version and the book keeps the first it sees,
    // so only the final state is sent.
    if (!last) return;
    const command = commandFor(userId, order, version);
    if (!command) return;
    const key = commandsKey(shardOf(command.token, shards));
    stream
      .xadd(key, 'MAXLEN', '~', MATCHER_COMMANDS_MAXLEN, '*', 'command', JSON.stringify(command))
      .then(onSent, onFailed);
  });
  return { stop };
}
