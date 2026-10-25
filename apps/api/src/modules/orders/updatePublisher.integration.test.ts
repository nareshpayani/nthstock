import { UserChannelEvent, orderUpdatesChannel } from '@nthstock/contracts';
import { MockMarketDataAdapter, generateSymbolMaster } from '@nthstock/marketData';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { buildApp } from '../../app.js';
import { loginWithOtp } from '../../test/authFlow.js';
import { manualClock } from '../../test/manualClock.js';
import { describeWithRedis, startTestRedis, type TestRedis } from '../../test/testRedis.js';
import { createRedisPublisher } from '../../ticks/publisher.js';

describeWithRedis('order updates to real Redis (T-133 integration)', () => {
  let redis: TestRedis | undefined;

  beforeAll(async () => {
    redis = await startTestRedis();
  }, 180_000);

  afterAll(async () => {
    await redis?.stop();
  });

  it("publishes a user's fill, then its account delta, on that user's channel only", async () => {
    const url = redis?.url ?? '';
    const clock = manualClock('2026-09-28T04:30:00.000Z');
    const master = generateSymbolMaster({ equityCount: 20 });
    const market = new MockMarketDataAdapter({
      master,
      clock,
      scheduler: { setInterval: () => 0, clearInterval: () => undefined },
    });
    const publisher = createRedisPublisher(url);
    const app = buildApp({
      deps: { clock, market },
      orderPublisher: publisher,
      orderSweepMs: null,
    });
    await app.ready();
    await publisher.ready();
    const alice = await loginWithOtp(app, '9876500001');
    const bob = await loginWithOtp(app, '9876500002');

    const subscriber = new Redis(url);
    const received: { channel: string; event: UserChannelEvent }[] = [];
    subscriber.on('message', (channel: string, message: string) => {
      received.push({ channel, event: UserChannelEvent.parse(JSON.parse(message)) });
    });
    await subscriber.subscribe(orderUpdatesChannel(alice.session.user.id));

    const token = master.equities[0]?.instrument.token ?? 0;
    for (const who of [bob, alice]) {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/orders',
        headers: { authorization: `Bearer ${who.access}`, 'x-csrf-token': 'bearer' },
        payload: { token, side: 'BUY', type: 'MARKET', product: 'DELIVERY', qty: 1 },
      });
      expect(response.statusCode).toBe(200);
    }

    await expect.poll(() => received.length, { timeout: 10_000 }).toBe(3);
    expect(
      received.map(({ event }) =>
        'order' in event
          ? [event.userId, event.order.status]
          : [event.userId, event.delta.orders.map((order) => order.status).join()],
      ),
    ).toEqual([
      [alice.session.user.id, 'OPEN'],
      [alice.session.user.id, 'EXECUTED'],
      // The delta carries the order's latest copy, at its seq, with the position it opened.
      [alice.session.user.id, 'EXECUTED'],
    ]);
    const delta = received[2]?.event;
    if (!delta || !('delta' in delta)) throw new Error('expected an account delta');
    expect(delta.delta.seq).toBe(delta.delta.orders[0]?.seq);
    expect(delta.delta.positions.map((p) => p.netQty)).toEqual([1]);
    expect(delta.delta.funds).toBeDefined();
    expect(new Set(received.map((r) => r.channel))).toEqual(
      new Set([orderUpdatesChannel(alice.session.user.id)]),
    );

    await subscriber.quit();
    await app.close();
    market.dispose();
  }, 60_000);
});
