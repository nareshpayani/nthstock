import { TICKS_CHANNEL, TickBatch, type Quote } from '@nthstock/contracts';
import { Redis } from 'ioredis';
import { silentLogger, type Logger } from './logger.js';

export type QuoteListener = (quotes: readonly Quote[]) => void;

/** Where ticks come from: Redis pub/sub in a running server, an in-memory feed in unit tests. */
export type QuoteFeed = {
  onQuotes(listener: QuoteListener): () => void;
  close(): Promise<void>;
};

const listenerSet = () => {
  const listeners = new Set<QuoteListener>();
  return {
    add(listener: QuoteListener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    emit(quotes: readonly Quote[]) {
      for (const listener of [...listeners]) listener(quotes);
    },
    clear: () => listeners.clear(),
  };
};

export type RedisQuoteFeed = QuoteFeed & {
  /** Resolves once the channel subscription is active. */
  ready(): Promise<void>;
};

export type RedisQuoteFeedOptions = {
  url: string;
  /** Defaults to `TICKS_CHANNEL`. */
  channel?: string;
  logger?: Logger;
};

/**
 * Subscribes to the ticks channel apps/api publishes on (T-072, ioredis per ADR 0004). Messages
 * that do not parse as a `TickBatch` are dropped and logged. ioredis resubscribes after a
 * reconnect; connection errors are logged once per outage.
 */
export function createRedisQuoteFeed(options: RedisQuoteFeedOptions): RedisQuoteFeed {
  const logger = options.logger ?? silentLogger;
  const channel = options.channel ?? TICKS_CHANNEL;
  const listeners = listenerSet();
  const client = new Redis(options.url);
  let down = false;
  client.on('error', (error: Error) => {
    if (down) return;
    down = true;
    logger.warn('Redis feed unavailable', { error: error.message });
  });
  client.on('ready', () => {
    if (down) logger.info('Redis feed reconnected');
    down = false;
  });
  client.on('message', (from: string, message: string) => {
    if (from !== channel) return;
    let json: unknown;
    try {
      json = JSON.parse(message);
    } catch {
      json = undefined;
    }
    const parsed = TickBatch.safeParse(json);
    if (!parsed.success) {
      logger.warn('Dropped a malformed tick batch', { channel });
      return;
    }
    listeners.emit(parsed.data.quotes);
  });
  const subscribed = client.subscribe(channel);
  // A failed first subscribe surfaces through ready(); the 'error' handler logs the outage.
  subscribed.catch(() => undefined);
  return {
    onQuotes: listeners.add,
    ready: () => subscribed.then(() => undefined),
    async close() {
      listeners.clear();
      try {
        await client.quit();
      } catch {
        client.disconnect();
      }
    },
  };
}

export type MemoryQuoteFeed = QuoteFeed & {
  emit(quotes: readonly Quote[]): void;
  readonly closed: boolean;
};

export function createMemoryQuoteFeed(): MemoryQuoteFeed {
  const listeners = listenerSet();
  let closed = false;
  return {
    onQuotes: listeners.add,
    emit: listeners.emit,
    close() {
      closed = true;
      listeners.clear();
      return Promise.resolve();
    },
    get closed() {
      return closed;
    },
  };
}
