import { TickBatch } from '@nthstock/contracts';
import { generateSymbolMaster, MockMarketDataAdapter } from '@nthstock/marketData';
import { fixedClock } from '@nthstock/utils';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  describeWithRedis,
  startTestRedis,
  uniqueChannel,
  type TestRedis,
} from '../test/testRedis.js';
import { createRedisPublisher } from './publisher.js';
import { startTickPump } from './tickPump.js';

describeWithRedis('tick publishing to real Redis (integration)', () => {
  let redis: TestRedis | undefined;

  beforeAll(async () => {
    redis = await startTestRedis();
  }, 180_000);

  afterAll(async () => {
    await redis?.stop();
  });

  it('delivers adapter ticks on the ticks channel', async () => {
    const channel = uniqueChannel('test:ticks');
    const url = redis?.url ?? '';
    const subscriber = new Redis(url);
    const received = new Promise<TickBatch>((resolve) => {
      subscriber.on('message', (_channel: string, message: string) => {
        resolve(TickBatch.parse(JSON.parse(message)));
      });
    });
    await subscriber.subscribe(channel);

    const publisher = createRedisPublisher(url);
    await publisher.ready();
    const market = new MockMarketDataAdapter({
      master: generateSymbolMaster({ equityCount: 60 }),
      clock: fixedClock('2026-09-25T05:00:00.000Z'),
      alwaysOpen: true,
      scheduler: { setInterval: () => 0, clearInterval: () => undefined },
    });
    const pump = await startTickPump({
      market,
      publisher,
      channel,
      log: { info: () => undefined, warn: () => undefined },
    });
    market.tick();

    const batch = await received;
    expect(batch.quotes.length).toBeGreaterThan(0);
    expect(batch.quotes[0]?.ts).toBe('2026-09-25T05:00:00.000Z');

    pump.stop();
    market.dispose();
    await publisher.close();
    await subscriber.quit();
  });
});
