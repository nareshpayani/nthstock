/**
 * The shard an instrument belongs to (spec market-data-and-matching §3): FNV-1a (32-bit) over the
 * token's four bytes, little endian, modulo the shard count. Every process that splits work by
 * instrument (the quote service, the matcher, the candle writer) uses this one function, so an
 * instrument's ticks, orders and bars always land on the same shard.
 */
export function shardOf(token: number, shards: number): number {
  if (!Number.isSafeInteger(token) || token < 0 || token > 0xffff_ffff) {
    throw new RangeError(`An instrument token is a 32-bit unsigned integer, got ${String(token)}`);
  }
  if (!Number.isSafeInteger(shards) || shards < 1) {
    throw new RangeError(`The shard count must be a positive integer, got ${String(shards)}`);
  }
  let hash = 0x811c_9dc5;
  for (let byte = 0; byte < 4; byte += 1) {
    hash ^= (token >>> (byte * 8)) & 0xff;
    hash = Math.imul(hash, 0x0100_0193) >>> 0;
  }
  return hash % shards;
}
