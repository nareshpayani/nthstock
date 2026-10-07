import {
  ACCESS_TOKEN_TTL_SEC,
  DEFAULT_REDIS_NAMESPACE,
  SessionRevokedEvent,
  sessionRevokedChannel,
  sessionRevokedKey,
} from '@nthstock/contracts';
import { Redis } from 'ioredis';
import { silentLogger, type Logger } from '../logger.js';

/** Longest an upgrade waits for the revocation check before going ahead. */
export const REVOCATION_CHECK_TIMEOUT_MS = 250;

export type RevokedSessionListener = (event: { sessionId: string; userId: string }) => void;

/**
 * Session revocations as apps/realtime sees them (T-195, spec backend-core §7.2): apps/api marks a
 * revoked session in Redis and publishes `auth:sessionRevoked` (T-194). The server closes that
 * session's sockets on the event and refuses a new upgrade for a marked session.
 */
export type SessionRevocationFeed = {
  onRevoked(listener: RevokedSessionListener): () => void;
  /** True when the session is marked revoked; checked on every upgrade. */
  isRevoked(sessionId: string): Promise<boolean>;
  /**
   * True when this node heard the session's revocation event within an access token's lifetime.
   * Synchronous, so an upgrade that raced the event is still refused.
   */
  revokedHere(sessionId: string): boolean;
  close(): Promise<void>;
};

/** Sessions this node heard revoked, forgotten once no access token of theirs can still be live. */
function recentRevocations(now: () => number) {
  const until = new Map<string, number>();
  const ttlMs = ACCESS_TOKEN_TTL_SEC * 1000;
  return {
    add(sessionId: string) {
      const at = now();
      // Map keeps insertion order, so the oldest entries are first.
      for (const [id, expiresAt] of until) {
        if (expiresAt > at) break;
        until.delete(id);
      }
      until.delete(sessionId);
      until.set(sessionId, at + ttlMs);
    },
    has: (sessionId: string) => (until.get(sessionId) ?? 0) > now(),
    clear: () => until.clear(),
  };
}

function listenerSet() {
  const listeners = new Set<RevokedSessionListener>();
  return {
    add(listener: RevokedSessionListener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    emit(event: { sessionId: string; userId: string }) {
      for (const listener of [...listeners]) listener(event);
    },
    clear: () => listeners.clear(),
  };
}

export type RedisSessionRevocationFeed = SessionRevocationFeed & {
  /** Resolves once the SUBSCRIBE has been acknowledged (tests). */
  settled(): Promise<void>;
};

/**
 * Subscribes to `sessionRevokedChannel(namespace)` on one connection and checks
 * `sessionRevokedKey` on another (a subscribed connection runs no other commands). A message
 * that does not parse as a `SessionRevokedEvent` is dropped and logged by channel only. If Redis
 * cannot answer an upgrade's check within `REVOCATION_CHECK_TIMEOUT_MS`, the upgrade goes ahead (logged): the token is still verified,
 * and apps/api refuses a revoked session on every request.
 */
export function createRedisSessionRevocationFeed(options: {
  url: string;
  logger?: Logger;
  namespace?: string;
  now?: () => number;
}): RedisSessionRevocationFeed {
  const logger = options.logger ?? silentLogger;
  const namespace = options.namespace ?? DEFAULT_REDIS_NAMESPACE;
  const channel = sessionRevokedChannel(namespace);
  const listeners = listenerSet();
  const recent = recentRevocations(options.now ?? Date.now);
  const subscriber = new Redis(options.url);
  // Fails fast while disconnected, and gives up on a slow answer: an upgrade never waits on Redis.
  const commands = new Redis(options.url, {
    enableOfflineQueue: false,
    commandTimeout: REVOCATION_CHECK_TIMEOUT_MS,
    maxRetriesPerRequest: 0,
  });

  let down = false;
  subscriber.on('error', (error: Error) => {
    if (down) return;
    down = true;
    logger.warn('Redis session revocation feed unavailable', { error: error.message });
  });
  subscriber.on('ready', () => {
    if (down) logger.info('Redis session revocation feed reconnected');
    down = false;
  });
  commands.on('error', () => {
    // Reported by the subscriber's handler and by the failed check itself.
  });
  subscriber.on('message', (from: string, message: string) => {
    if (from !== channel) return;
    let json: unknown;
    try {
      json = JSON.parse(message);
    } catch {
      json = undefined;
    }
    const parsed = SessionRevokedEvent.safeParse(json);
    if (!parsed.success) {
      logger.warn('Dropped a malformed session revocation', { channel: from });
      return;
    }
    const { sessionId, userId } = parsed.data;
    recent.add(sessionId);
    listeners.emit({ sessionId, userId });
  });
  const subscribed = subscriber.subscribe(channel).catch((error: unknown) => {
    logger.warn('Redis session revocation subscribe failed', { error: String(error) });
  });

  return {
    onRevoked: listeners.add,
    revokedHere: recent.has,
    async isRevoked(sessionId) {
      if (recent.has(sessionId)) return true;
      try {
        return (await commands.exists(sessionRevokedKey(sessionId, namespace))) === 1;
      } catch (error) {
        logger.warn('Session revocation check failed', { error: String(error) });
        return false;
      }
    },
    settled: () => subscribed.then(() => undefined),
    async close() {
      listeners.clear();
      recent.clear();
      await Promise.all(
        [subscriber, commands].map(async (client) => {
          // QUIT waits for a connection that may never come back; drop one that is not up.
          if (client.status !== 'ready') {
            client.disconnect();
            return;
          }
          try {
            await client.quit();
          } catch {
            client.disconnect();
          }
        }),
      );
    },
  };
}

export type MemorySessionRevocationFeed = SessionRevocationFeed & {
  /** Marks the session revoked and announces it, as apps/api does. */
  revoke(sessionId: string, userId: string): void;
};

export function createMemorySessionRevocationFeed(
  now: () => number = Date.now,
): MemorySessionRevocationFeed {
  const listeners = listenerSet();
  const recent = recentRevocations(now);
  return {
    onRevoked: listeners.add,
    revokedHere: recent.has,
    isRevoked: (sessionId) => Promise.resolve(recent.has(sessionId)),
    revoke(sessionId, userId) {
      recent.add(sessionId);
      listeners.emit({ sessionId, userId });
    },
    close() {
      listeners.clear();
      recent.clear();
      return Promise.resolve();
    },
  };
}
