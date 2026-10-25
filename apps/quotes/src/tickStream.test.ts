import {
  TICK_BATCH_VERSION,
  quoteSnapshotKey,
  tickStreamKey,
  type Quote,
  type TickStreamEntry,
} from '@nthstock/contracts';
import type { Redis } from 'ioredis';
import { describe, expect, it } from 'vitest';
import { createRedisTickSink } from './tickStream.js';

// tickStream.integration.test.ts runs the sink on a real Redis; this covers its keys and its
// failure paths on a stand-in for MULTI.

type Call = [command: string, key: string, ...args: (string | number)[]];

function fakeRedis(answer: [Error | null, unknown][] | null) {
  const calls: Call[] = [];
  const multi = {
    xadd: (key: string, ...args: (string | number)[]) => {
      calls.push(['xadd', key, ...args]);
      return multi;
    },
    hset: (key: string, ...args: (string | number)[]) => {
      calls.push(['hset', key, ...args]);
      return multi;
    },
    exec: () => Promise.resolve(answer),
  };
  // Only `multi` is called; the cast is the narrow stand-in for an ioredis client.
  return { redis: { multi: () => multi } as unknown as Redis, calls };
}

const quote = (token: number, ltp: number) => ({ token, ltp }) as unknown as Quote;
const entry = (quotes: Quote[]): TickStreamEntry => ({
  v: TICK_BATCH_VERSION,
  shard: 2,
  seq: 1,
  quotes,
});

describe('createRedisTickSink', () => {
  it('writes the batch and the latest quote per token to the default shard keys', async () => {
    const { redis, calls } = fakeRedis([
      [null, '1-0'],
      [null, 1],
    ]);
    await createRedisTickSink({ redis }).append(entry([quote(7, 100), quote(7, 105)]));
    expect(calls.map(([command, key]) => [command, key])).toEqual([
      ['xadd', tickStreamKey(2)],
      ['hset', quoteSnapshotKey(2)],
    ]);
    expect(calls[1]?.slice(2)).toEqual(['7', JSON.stringify(quote(7, 105))]);
  });

  it('throws the error of a failed command, and when MULTI was discarded', async () => {
    const failed = new Error('OOM command not allowed');
    await expect(
      createRedisTickSink({
        redis: fakeRedis([
          [null, '1-0'],
          [failed, null],
        ]).redis,
      }).append(entry([quote(1, 100)])),
    ).rejects.toBe(failed);
    await expect(
      createRedisTickSink({ redis: fakeRedis(null).redis }).append(entry([quote(1, 100)])),
    ).rejects.toThrow('The tick batch was not written');
  });
});
