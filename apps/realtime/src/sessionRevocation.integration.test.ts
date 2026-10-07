import {
  ACCESS_TOKEN_TTL_SEC,
  SESSION_REVOKED_EVENT_VERSION,
  WS_CLOSE_CODES,
  sessionRevokedChannel,
  sessionRevokedKey,
} from '@nthstock/contracts';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { createRealtimeServer, WS_PATH } from './app.js';
import { createRedisSessionRevocationFeed } from './sessionRevocationFeed.js';
import { connectAuthed, testAuthenticator } from './test/auth.js';
import { describeWithRedis, startTestRedis, type TestRedis } from './test/testRedis.js';

const REVOKED = { code: WS_CLOSE_CODES.unauthorized, reason: 'Session revoked' };

describeWithRedis('auth:sessionRevoked to WebSocket clients (T-195 integration)', () => {
  let redis: TestRedis | undefined;
  let publisher: Redis;

  beforeAll(async () => {
    redis = await startTestRedis();
    publisher = new Redis(redis.url);
  }, 180_000);

  afterAll(async () => {
    await publisher?.quit();
    await redis?.stop();
  });

  /** A namespace of its own, so parallel runs on one Redis never see each other's events. */
  const namespace = () => `t195:${process.pid}:${Math.random().toString(36).slice(2, 10)}:`;

  /** What apps/api does on a revocation (createRedisSessionRevocations, T-194). */
  const revoke = async (ns: string, sessionId: string, userId: string) => {
    await publisher.set(sessionRevokedKey(sessionId, ns), '1', 'EX', ACCESS_TOKEN_TTL_SEC);
    await publisher.publish(
      sessionRevokedChannel(ns),
      JSON.stringify({ v: SESSION_REVOKED_EVENT_VERSION, sessionId, userId }),
    );
  };

  it("closes a revoked session's sockets within 1 s and keeps the same user's other session", async () => {
    const ns = namespace();
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const revocations = createRedisSessionRevocationFeed({
      url: redis?.url ?? '',
      logger,
      namespace: ns,
    });
    const server = createRealtimeServer({ authenticate: testAuthenticator(), revocations });
    const port = await server.listen(0, '127.0.0.1');
    const url = `ws://127.0.0.1:${port}${WS_PATH}`;
    await revocations.settled();

    const a1 = await connectAuthed(url, 'usr_alice', 'ses_a');
    const a2 = await connectAuthed(url, 'usr_alice', 'ses_a');
    const b = await connectAuthed(url, 'usr_alice', 'ses_b');
    expect(server.connectionCount()).toBe(3);

    // Malformed events are dropped (logged by channel only) and close nothing.
    await publisher.publish(sessionRevokedChannel(ns), 'not json');
    await publisher.publish(
      sessionRevokedChannel(ns),
      JSON.stringify({ v: 99, sessionId: 'ses_b', userId: 'usr_alice' }),
    );

    const revokedAt = Date.now();
    await revoke(ns, 'ses_a', 'usr_alice');
    expect(await a1.closed).toEqual(REVOKED);
    expect(await a2.closed).toEqual(REVOKED);
    expect(Date.now() - revokedAt).toBeLessThan(1_000);

    expect(await b.drain()).toEqual([]);
    expect(server.connectionCount()).toBe(1);
    expect(logger.warn).toHaveBeenCalledTimes(2);
    expect(logger.warn).toHaveBeenCalledWith('Dropped a malformed session revocation', {
      channel: sessionRevokedChannel(ns),
    });

    // A reconnect with the revoked session's token is refused.
    const again = await connectAuthed(url, 'usr_alice', 'ses_a');
    expect(await again.closed).toEqual(REVOKED);

    b.close();
    await server.close();
  }, 30_000);

  it('refuses an upgrade for a session marked revoked before this node started', async () => {
    const ns = namespace();
    await publisher.set(sessionRevokedKey('ses_old', ns), '1', 'EX', 60);
    const revocations = createRedisSessionRevocationFeed({ url: redis?.url ?? '', namespace: ns });
    const server = createRealtimeServer({ authenticate: testAuthenticator(), revocations });
    const port = await server.listen(0, '127.0.0.1');
    const url = `ws://127.0.0.1:${port}${WS_PATH}`;

    const old = await connectAuthed(url, 'usr_alice', 'ses_old');
    expect(await old.closed).toEqual(REVOKED);
    const fresh = await connectAuthed(url, 'usr_alice', 'ses_new');
    expect(await fresh.drain()).toEqual([]);

    fresh.close();
    await server.close();
  }, 30_000);

  it('lets the upgrade through, logged, when Redis cannot answer the check', async () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const revocations = createRedisSessionRevocationFeed({
      url: 'redis://127.0.0.1:1',
      logger,
      namespace: namespace(),
    });
    expect(await revocations.isRevoked('ses_a')).toBe(false);
    expect(logger.warn).toHaveBeenCalledWith('Session revocation check failed', {
      error: expect.any(String) as unknown,
    });
    await revocations.close();
  }, 30_000);
});
