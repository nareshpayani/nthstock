import { describe, expect, it } from 'vitest';
import { quoteFixture } from './fixtures.js';
import { Quote } from './market.js';
import {
  QUOTE_FRAME_HEADER_BYTES,
  QUOTE_FRAME_MAX_AGE_MS,
  QUOTE_RECORD_BYTES,
  createQuoteFrameDecoder,
  encodeQuoteFrame,
  instrumentOf,
} from './quoteFrame.js';

/** mulberry32: a small seeded PRNG so the property test is reproducible. */
function prng(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

const U32 = 0xffff_ffff;
const BASE_MS = Date.parse('2026-09-25T03:45:00.000Z');
const SYMBOL_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789&-';

/** A random quote anywhere in the codec's documented domain, including its edges. */
function randomQuote(random: () => number, token: number, baseMs: number): Quote {
  const int = (min: number, max: number) => min + Math.floor(random() * (max - min + 1));
  const edge = (min: number, max: number) => {
    const r = random();
    if (r < 0.05) return min;
    if (r < 0.1) return max;
    return int(min, max);
  };
  const symbol = Array.from({ length: int(1, 20) }, () => SYMBOL_CHARS[int(0, 37)]).join('');
  const prevClose = edge(0, U32);
  const ltp = edge(0, U32);
  return Quote.parse({
    token,
    symbol,
    exchange: random() < 0.5 ? 'NSE' : 'BSE',
    ltp,
    change: ltp - prevClose,
    changeBp: edge(-0x8000, 0x7fff),
    open: edge(0, U32),
    high: edge(0, U32),
    low: edge(0, U32),
    prevClose,
    volume: edge(0, U32),
    ts: new Date(baseMs - edge(0, QUOTE_FRAME_MAX_AGE_MS)).toISOString(),
  });
}

describe('binary quote frame', () => {
  it('round-trips random frames exactly at 24 bytes per quote (property test)', () => {
    const random = prng(20260925);
    for (let run = 0; run < 500; run += 1) {
      const count = Math.floor(random() * 200) + 1;
      const baseMs = BASE_MS + Math.floor(random() * 1e9);
      const quotes = Array.from({ length: count }, (_, i) =>
        randomQuote(random, 1 + Math.floor(random() * (U32 - count)) + i, baseMs),
      );
      const frame = encodeQuoteFrame(quotes);
      expect(frame.byteLength).toBe(QUOTE_FRAME_HEADER_BYTES + count * QUOTE_RECORD_BYTES);
      const decoder = createQuoteFrameDecoder();
      decoder.learn(quotes.map(instrumentOf));
      expect(decoder.decode(frame)).toEqual(quotes);
    }
  });

  it('costs at most 24 bytes per symbol', () => {
    expect(QUOTE_RECORD_BYTES).toBeLessThanOrEqual(24);
    const one = encodeQuoteFrame([quoteFixture]).byteLength;
    const two = encodeQuoteFrame([quoteFixture, { ...quoteFixture, token: 2 }]).byteLength;
    expect(two - one).toBe(QUOTE_RECORD_BYTES);
  });

  it('decodes from a Node Buffer-style view with an offset, and an empty frame', () => {
    const frame = encodeQuoteFrame([quoteFixture]);
    const padded = new Uint8Array(frame.byteLength + 5);
    padded.set(frame, 5);
    const decoder = createQuoteFrameDecoder();
    decoder.learn([instrumentOf(quoteFixture)]);
    expect(decoder.decode(padded.subarray(5))).toEqual([quoteFixture]);
    expect(decoder.decode(frame.buffer)).toEqual([quoteFixture]);
    expect(decoder.decode(encodeQuoteFrame([]))).toEqual([]);
  });

  it('skips tokens it has not learned, and uses updated instruments', () => {
    const decoder = createQuoteFrameDecoder();
    const frame = encodeQuoteFrame([quoteFixture]);
    expect(decoder.decode(frame)).toEqual([]);
    decoder.learn([instrumentOf(quoteFixture)]);
    const nextDay = { ...quoteFixture, prevClose: quoteFixture.ltp, change: 0, changeBp: 0 };
    decoder.learn([instrumentOf(nextDay)]);
    expect(decoder.decode(encodeQuoteFrame([nextDay]))).toEqual([nextDay]);
  });

  it('refuses values that do not fit', () => {
    const tooOld = { ...quoteFixture, ts: new Date(BASE_MS).toISOString() };
    const newest = { ...quoteFixture, ts: new Date(BASE_MS + 70_000).toISOString() };
    expect(() => encodeQuoteFrame([newest, tooOld])).toThrow(RangeError);
    expect(() => encodeQuoteFrame([{ ...quoteFixture, volume: 2 ** 32 }])).toThrow(/volume/);
    expect(() => encodeQuoteFrame([{ ...quoteFixture, changeBp: 40_000 }])).toThrow(/changeBp/);
    expect(() => encodeQuoteFrame([{ ...quoteFixture, change: quoteFixture.change + 5 }])).toThrow(
      /ltp - prevClose/,
    );
  });

  it('rejects bytes that are not a quote frame', () => {
    const decoder = createQuoteFrameDecoder();
    expect(() => decoder.decode(new Uint8Array([1, 2, 3]))).toThrow(RangeError);
    const wrongVersion = encodeQuoteFrame([quoteFixture]);
    wrongVersion[1] = 9;
    expect(() => decoder.decode(wrongVersion)).toThrow(/version/);
    const truncated = encodeQuoteFrame([quoteFixture]).subarray(0, 20);
    expect(() => decoder.decode(truncated)).toThrow(/length/);
  });
});
