import { describe, expect, it } from 'vitest';
import { shardOf } from './shard.js';

describe('shardOf', () => {
  it('puts every token on shard 0 when there is one shard', () => {
    for (const token of [0, 1, 2885, 0xffff_ffff]) expect(shardOf(token, 1)).toBe(0);
  });

  it('is FNV-1a over the token bytes', () => {
    // FNV-1a of the bytes 00 00 00 00 is 0x4b95f515.
    expect(shardOf(0, 0x1_0000_0000 - 1)).toBe(0x4b95_f515 % (0x1_0000_0000 - 1));
  });

  it('spreads 5,000 tokens over 4 shards within 10% of even', () => {
    const counts = [0, 0, 0, 0];
    for (let token = 1; token <= 5_000; token += 1) {
      const shard = shardOf(token, 4);
      counts[shard] = (counts[shard] ?? 0) + 1;
    }
    for (const count of counts) expect(Math.abs(count - 1_250)).toBeLessThan(125);
  });

  it('gives the same shard every time', () => {
    expect(shardOf(2885, 4)).toBe(shardOf(2885, 4));
  });

  it('refuses a token or shard count out of range', () => {
    expect(() => shardOf(-1, 4)).toThrow(RangeError);
    expect(() => shardOf(1.5, 4)).toThrow(RangeError);
    expect(() => shardOf(0x1_0000_0000, 4)).toThrow(RangeError);
    expect(() => shardOf(1, 0)).toThrow(RangeError);
  });
});
