import {
  ACCESS_TOKEN_TTL_SEC,
  DEFAULT_REDIS_NAMESPACE,
  SESSION_REVOKED_EVENT_VERSION,
  sessionRevokedChannel,
  sessionRevokedKey,
  type SessionRevokedEvent,
} from '@nthstock/contracts';
import type { Redis } from 'ioredis';

export type RevokedSession = { sessionId: string; userId: string };

/**
 * The session-revocation cache and event (T-194, spec backend-core §7.2). Postgres
 * (`sessions.revoked_at`) is the record; this makes a revocation reach every apps/api instance
 * and apps/realtime at once.
 */
export interface SessionRevocations {
  /**
   * Marks the session revoked for as long as its access tokens live and publishes
   * `auth:sessionRevoked`. Call after the session row is revoked.
   */
  revoked(session: RevokedSession): Promise<void>;
  /** True when the session is marked revoked; checked before the session row is read. */
  isRevoked(sessionId: string): Promise<boolean>;
}

/**
 * In Redis: `SET <ns>sess:revoked:<id> 1 EX ACCESS_TOKEN_TTL_SEC` then `PUBLISH
 * <ns>auth:sessionRevoked:v1 {v, sessionId, userId}`. After the TTL every access token of the
 * session has expired anyway, and refreshing it reads the session row.
 */
export function createRedisSessionRevocations({
  redis,
  namespace = DEFAULT_REDIS_NAMESPACE,
}: {
  redis: Redis;
  namespace?: string;
}): SessionRevocations {
  return {
    async revoked({ sessionId, userId }) {
      const event: SessionRevokedEvent = { v: SESSION_REVOKED_EVENT_VERSION, sessionId, userId };
      await redis.set(sessionRevokedKey(sessionId, namespace), '1', 'EX', ACCESS_TOKEN_TTL_SEC);
      await redis.publish(sessionRevokedChannel(namespace), JSON.stringify(event));
    },
    async isRevoked(sessionId) {
      return (await redis.exists(sessionRevokedKey(sessionId, namespace))) === 1;
    },
  };
}

export type MemorySessionRevocations = SessionRevocations & {
  /** Every revocation so far, in order (tests). */
  readonly events: readonly RevokedSession[];
};

/**
 * One process (`DB_DRIVER=memory`): there is no other instance to tell, and the session row in
 * the memory repo is already read on every request. Keeps the events for tests.
 */
export function createMemorySessionRevocations(): MemorySessionRevocations {
  const events: RevokedSession[] = [];
  const revokedIds = new Set<string>();
  return {
    events,
    revoked(session) {
      events.push({ ...session });
      revokedIds.add(session.sessionId);
      return Promise.resolve();
    },
    isRevoked: (sessionId) => Promise.resolve(revokedIds.has(sessionId)),
  };
}
