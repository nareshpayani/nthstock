import { createServer } from 'node:net';
import { createQuoteFrameDecoder, type Quote } from '@nthstock/contracts';
import type { TestClient } from './wsTestClient.js';

// Shared by the wall-clock latency tests (`*.latency.test.ts`, `npm run test:latency`).

/** One frame at 60 Hz: the quote store paints on the next animation frame. */
const FRAME_MS = 1000 / 60;

export const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      probe.close(() => resolve(port));
    });
  });

export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)] ?? Number.NaN;
}

export type LatencySample = { latencies: number[]; seen: Set<string> };

/**
 * Reads `client` for `ms` and returns, per quote received, receive time − the quote's `ts` (stamped
 * by the mock adapter when it ticks; every process shares this machine's clock) + one frame, which
 * is tick-to-screen. Frames are decoded with the browser's decoder.
 */
export async function sampleTickToScreen(client: TestClient, ms: number): Promise<LatencySample> {
  const decoder = createQuoteFrameDecoder();
  const latencies: number[] = [];
  const seen = new Set<string>();
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const frame = await Promise.race([
      client.next(),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), until - Date.now())),
    ]);
    if (!frame) break;
    const receivedAt = Date.now();
    let quotes: Quote[] = [];
    if (frame.kind === 'binary') quotes = decoder.decode(frame.data);
    else if (frame.message.type === 'instruments') decoder.learn(frame.message.instruments);
    else if (frame.message.type === 'quotes') quotes = frame.message.quotes;
    for (const quote of quotes) {
      seen.add(quote.symbol);
      latencies.push(receivedAt - Date.parse(quote.ts) + FRAME_MS);
    }
  }
  return { latencies, seen };
}

/** The one line each latency test prints. */
export function describeSample(label: string, { latencies, seen }: LatencySample): string {
  const max = Math.max(...latencies);
  return (
    `\n[${label}] ${String(latencies.length)} quotes, ${String(seen.size)} symbols: ` +
    `p50 ${percentile(latencies, 50).toFixed(1)} ms, p95 ${percentile(latencies, 95).toFixed(1)} ms, ` +
    `max ${max.toFixed(1)} ms\n`
  );
}
