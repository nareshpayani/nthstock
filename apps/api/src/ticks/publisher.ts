import { Redis } from 'ioredis';

/** Where ticks go. Redis in a running server; an in-memory recorder in unit tests. */
export type Publisher = {
  publish(channel: string, message: string): Promise<void>;
  close(): Promise<void>;
};

/** The two log levels the Redis wiring uses; Fastify's `app.log` fits. */
export type PublisherLog = {
  info(message: string): void;
  warn(message: string): void;
};

export type RedisPublisher = Publisher & {
  /** Resolves once the connection is ready to publish. */
  ready(): Promise<void>;
};

/**
 * Redis publisher (ioredis, ADR 0004). Commands are not queued while disconnected: a tick that
 * cannot go out now is stale by the next one, so publishing fails fast instead of building a
 * backlog. Connection errors are logged once per outage, not once per retry.
 */
export function createRedisPublisher(url: string, log?: PublisherLog): RedisPublisher {
  const client = new Redis(url, { enableOfflineQueue: false, maxRetriesPerRequest: 1 });
  let down = false;
  client.on('error', (error: Error) => {
    if (down) return;
    down = true;
    log?.warn(`Redis publisher unavailable: ${error.message}`);
  });
  client.on('ready', () => {
    if (down) log?.info('Redis publisher reconnected');
    down = false;
  });
  return {
    async publish(channel, message) {
      await client.publish(channel, message);
    },
    ready: () =>
      client.status === 'ready'
        ? Promise.resolve()
        : new Promise((resolve) => {
            client.once('ready', () => resolve());
          }),
    async close() {
      try {
        await client.quit();
      } catch {
        client.disconnect();
      }
    },
  };
}

export type MemoryPublisher = Publisher & {
  readonly messages: { channel: string; message: string }[];
  /** Makes the next publishes reject, to exercise error handling. */
  fail(error: Error | null): void;
  readonly closed: boolean;
};

/** Records every publish; for unit tests. */
export function createMemoryPublisher(): MemoryPublisher {
  const messages: { channel: string; message: string }[] = [];
  let failure: Error | null = null;
  let closed = false;
  return {
    messages,
    fail(error) {
      failure = error;
    },
    publish(channel, message) {
      if (failure) return Promise.reject(failure);
      messages.push({ channel, message });
      return Promise.resolve();
    },
    close() {
      closed = true;
      return Promise.resolve();
    },
    get closed() {
      return closed;
    },
  };
}
