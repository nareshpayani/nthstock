import type { Quote } from './market.js';
import type { WsInstrument } from './ws.js';

/**
 * Compact binary quote frames (T-074, ADR 0004 §4, CLAUDE.md §4 "compact binary frames").
 *
 * apps/realtime sends quotes as binary WebSocket frames keyed by instrument token; control messages
 * stay JSON (`ws.ts`). A frame is a 12-byte header followed by one 24-byte record per quote, all
 * little-endian:
 *
 * | Offset | Header field | Type |
 * | ------ | ------------ | ---- |
 * | 0      | magic `0x51` ('Q') | u8 |
 * | 1      | format version (1) | u8 |
 * | 2      | quote count        | u16 |
 * | 4      | base time: the newest quote's `ts`, epoch ms | f64 |
 *
 * | Offset | Record field | Type |
 * | ------ | ------------ | ---- |
 * | 0      | token             | u32 |
 * | 4      | ltp (paise)       | u32 |
 * | 8      | high (paise)      | u32 |
 * | 12     | low (paise)       | u32 |
 * | 16     | volume            | u32 |
 * | 20     | changeBp          | i16 |
 * | 22     | age: base time − `ts`, ms | u16 |
 *
 * Fields a record leaves out come from the `instruments` control message for its token: `symbol`,
 * `exchange`, `open` and `prevClose`. `change` is `ltp − prevClose` by definition.
 *
 * Limits, checked by the encoder (a `RangeError`; the server then falls back to a JSON `quotes`
 * message): token, prices and volume fit a u32 (₹4.29 crore a share, 4.29 billion shares a day);
 * `changeBp` fits an i16 (±327%); quotes in one frame are at most 65.535 s apart; ≤ 65,535 quotes.
 * `ts` is carried at millisecond precision and decodes in `toISOString()` form.
 */

export const QUOTE_FRAME_MAGIC = 0x51;
export const QUOTE_FRAME_VERSION = 1;
export const QUOTE_FRAME_HEADER_BYTES = 12;
/** Bytes per quote in a frame. */
export const QUOTE_RECORD_BYTES = 24;
export const QUOTE_FRAME_MAX_AGE_MS = 0xffff;

const U32_MAX = 0xffff_ffff;
const U16_MAX = 0xffff;

/** The instrument part of a quote, as the `instruments` control message carries it. */
export function instrumentOf(quote: Quote): WsInstrument {
  return {
    token: quote.token,
    symbol: quote.symbol,
    exchange: quote.exchange,
    open: quote.open,
    prevClose: quote.prevClose,
  };
}

const checkRange = (name: string, value: number, min: number, max: number) => {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new RangeError(`Quote frame: ${name} ${value} is outside ${min}..${max}`);
  }
};

/** Encodes quotes into one binary frame. Throws a `RangeError` if a value does not fit. */
export function encodeQuoteFrame(quotes: readonly Quote[]): Uint8Array<ArrayBuffer> {
  checkRange('quote count', quotes.length, 0, U16_MAX);
  const times = quotes.map((quote) => Date.parse(quote.ts));
  const base = times.length === 0 ? 0 : Math.max(...times);
  const bytes = new Uint8Array(QUOTE_FRAME_HEADER_BYTES + quotes.length * QUOTE_RECORD_BYTES);
  const view = new DataView(bytes.buffer);
  view.setUint8(0, QUOTE_FRAME_MAGIC);
  view.setUint8(1, QUOTE_FRAME_VERSION);
  view.setUint16(2, quotes.length, true);
  view.setFloat64(4, base, true);
  quotes.forEach((quote, index) => {
    const at = QUOTE_FRAME_HEADER_BYTES + index * QUOTE_RECORD_BYTES;
    const age = base - (times[index] ?? Number.NaN);
    checkRange('token', quote.token, 0, U32_MAX);
    checkRange('ltp', quote.ltp, 0, U32_MAX);
    checkRange('high', quote.high, 0, U32_MAX);
    checkRange('low', quote.low, 0, U32_MAX);
    checkRange('volume', quote.volume, 0, U32_MAX);
    checkRange('changeBp', quote.changeBp, -0x8000, 0x7fff);
    checkRange('age', age, 0, QUOTE_FRAME_MAX_AGE_MS);
    if (quote.change !== quote.ltp - quote.prevClose) {
      throw new RangeError(`Quote frame: change of ${quote.symbol} is not ltp - prevClose`);
    }
    view.setUint32(at, quote.token, true);
    view.setUint32(at + 4, quote.ltp, true);
    view.setUint32(at + 8, quote.high, true);
    view.setUint32(at + 12, quote.low, true);
    view.setUint32(at + 16, quote.volume, true);
    view.setInt16(at + 20, quote.changeBp, true);
    view.setUint16(at + 22, age, true);
  });
  return bytes;
}

export type QuoteFrameDecoder = {
  /** Remembers (or updates) instruments from an `instruments` control message. */
  learn(instruments: readonly WsInstrument[]): void;
  /**
   * Decodes a binary frame. Records for tokens not learned yet are skipped. Throws a `RangeError`
   * for bytes that are not a quote frame of this version.
   */
  decode(data: ArrayBuffer | ArrayBufferView): Quote[];
};

export function createQuoteFrameDecoder(): QuoteFrameDecoder {
  const instruments = new Map<number, WsInstrument>();
  return {
    learn(list) {
      for (const instrument of list) instruments.set(instrument.token, instrument);
    },
    decode(data) {
      const view = ArrayBuffer.isView(data)
        ? new DataView(data.buffer, data.byteOffset, data.byteLength)
        : new DataView(data);
      if (
        view.byteLength < QUOTE_FRAME_HEADER_BYTES ||
        view.getUint8(0) !== QUOTE_FRAME_MAGIC ||
        view.getUint8(1) !== QUOTE_FRAME_VERSION
      ) {
        throw new RangeError('Not a quote frame of a supported version');
      }
      const count = view.getUint16(2, true);
      if (view.byteLength !== QUOTE_FRAME_HEADER_BYTES + count * QUOTE_RECORD_BYTES) {
        throw new RangeError('Quote frame length does not match its count');
      }
      const base = view.getFloat64(4, true);
      const quotes: Quote[] = [];
      for (let index = 0; index < count; index += 1) {
        const at = QUOTE_FRAME_HEADER_BYTES + index * QUOTE_RECORD_BYTES;
        const instrument = instruments.get(view.getUint32(at, true));
        if (!instrument) continue;
        const ltp = view.getUint32(at + 4, true);
        quotes.push({
          token: instrument.token,
          symbol: instrument.symbol,
          exchange: instrument.exchange,
          ltp,
          change: ltp - instrument.prevClose,
          changeBp: view.getInt16(at + 20, true),
          open: instrument.open,
          high: view.getUint32(at + 8, true),
          low: view.getUint32(at + 12, true),
          prevClose: instrument.prevClose,
          volume: view.getUint32(at + 16, true),
          ts: new Date(base - view.getUint16(at + 22, true)).toISOString(),
        });
      }
      return quotes;
    },
  };
}
