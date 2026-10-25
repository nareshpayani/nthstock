import {
  ACCOUNT_DELTA_EVENT_VERSION,
  ORDER_UPDATE_EVENT_VERSION,
  WS_PROTOCOL_VERSION,
  orderUpdatesChannel,
  type Order,
} from '@nthstock/contracts';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { createRealtimeServer, WS_PATH } from '../app.js';
import { createRedisOrderFeed } from './orderFeed.js';
import { connectAuthed, testAuthenticator } from '../test/auth.js';
import { testAccountDelta, testOrder } from '../test/orders.js';
import { describeWithRedis, startTestRedis, type TestRedis } from '../test/testRedis.js';

describeWithRedis('Redis order channel to WebSocket clients (T-133 integration)', () => {
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

  it("delivers user A's fill to A only, and drops mismatched or malformed events", async () => {
    // Unique user ids, so parallel runs on one Redis never see each other's messages.
    const run = Math.random().toString(36).slice(2, 10);
    const [a, b] = [`usr_a_${run}`, `usr_b_${run}`];
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const orderFeed = createRedisOrderFeed({ url: redis?.url ?? '', logger });
    const server = createRealtimeServer({ authenticate: testAuthenticator(), orderFeed });
    const port = await server.listen(0, '127.0.0.1');
    const url = `ws://127.0.0.1:${port}${WS_PATH}`;
    const alice = await connectAuthed(url, a);
    const bob = await connectAuthed(url, b);
    await orderFeed.settled();

    const publish = (userId: string, order: Order, claimed = userId) =>
      publisher.publish(
        orderUpdatesChannel(userId),
        JSON.stringify({ v: ORDER_UPDATE_EVENT_VERSION, userId: claimed, order }),
      );
    await publisher.publish(orderUpdatesChannel(a), 'not json');
    await publish(a, testOrder('o_forged'), b); // claims to be B's, on A's channel
    await publish(b, testOrder('o_bob'));
    await publish(a, testOrder('o_alice'));

    expect(await alice.next()).toEqual({
      kind: 'json',
      message: { v: WS_PROTOCOL_VERSION, type: 'orderUpdate', order: testOrder('o_alice') },
    });
    expect(await bob.next()).toEqual({
      kind: 'json',
      message: { v: WS_PROTOCOL_VERSION, type: 'orderUpdate', order: testOrder('o_bob') },
    });
    expect(await alice.drain()).toEqual([]);
    expect(await bob.drain()).toEqual([]);
    expect(logger.warn).toHaveBeenCalledTimes(2);

    // After A's last connection closes, this node stops receiving A's channel.
    alice.close();
    await alice.closed;
    await vi.waitFor(async () => {
      await orderFeed.settled();
      const counts = (await publisher.pubsub('NUMSUB', orderUpdatesChannel(a))) as [string, number];
      expect(Number(counts[1])).toBe(0);
    });

    bob.close();
    await server.close();
  }, 60_000);

  it("sends user A's account delta to A only as an accountDelta frame (NSTOCK-0368)", async () => {
    const run = Math.random().toString(36).slice(2, 10);
    const [a, b] = [`usr_a_${run}`, `usr_b_${run}`];
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const orderFeed = createRedisOrderFeed({ url: redis?.url ?? '', logger });
    const server = createRealtimeServer({ authenticate: testAuthenticator(), orderFeed });
    const port = await server.listen(0, '127.0.0.1');
    const url = `ws://127.0.0.1:${port}${WS_PATH}`;
    const alice = await connectAuthed(url, a);
    const bob = await connectAuthed(url, b);
    await orderFeed.settled();

    const event = (userId: string, seq: number) => ({
      v: ACCOUNT_DELTA_EVENT_VERSION,
      type: 'accountDelta',
      userId,
      delta: testAccountDelta(seq),
    });
    await publisher.publish(orderUpdatesChannel(a), JSON.stringify(event(b, 1))); // forged
    await publisher.publish(
      orderUpdatesChannel(a),
      JSON.stringify({ ...event(a, 2), delta: { seq: 2 } }), // malformed
    );
    await publisher.publish(orderUpdatesChannel(a), JSON.stringify(event(a, 3)));

    expect(await alice.next()).toEqual({
      kind: 'json',
      message: { v: WS_PROTOCOL_VERSION, type: 'accountDelta', quotes: [], ...testAccountDelta(3) },
    });
    expect(await alice.drain()).toEqual([]);
    expect(await bob.drain()).toEqual([]);
    expect(logger.warn).toHaveBeenCalledTimes(2);

    alice.close();
    bob.close();
    await server.close();
  }, 60_000);
});
