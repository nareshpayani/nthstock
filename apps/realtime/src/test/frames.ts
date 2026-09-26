import { createQuoteFrameDecoder, type Quote, type WsServerMessage } from '@nthstock/contracts';

type Frame =
  | string
  | Uint8Array
  | { kind: 'json'; message: WsServerMessage }
  | { kind: 'binary'; data: Uint8Array };

/**
 * Decodes what a client received, in order, the way the WS client does: `instruments` messages
 * teach the decoder, binary frames become quotes, JSON `quotes` pass through. Returns one quote
 * list per quote-carrying frame.
 */
export function quoteFramesOf(frames: readonly Frame[]): Quote[][] {
  const decoder = createQuoteFrameDecoder();
  const out: Quote[][] = [];
  for (const frame of frames) {
    if (frame instanceof Uint8Array) {
      out.push(decoder.decode(frame));
      continue;
    }
    const message =
      typeof frame === 'string'
        ? (JSON.parse(frame) as WsServerMessage)
        : frame.kind === 'json'
          ? frame.message
          : null;
    if (message === null) {
      if (typeof frame === 'object' && 'data' in frame) out.push(decoder.decode(frame.data));
      continue;
    }
    if (message.type === 'instruments') decoder.learn(message.instruments);
    if (message.type === 'quotes') out.push(message.quotes);
  }
  return out;
}
