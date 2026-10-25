import type { MatcherFill } from '@nthstock/contracts';
import { describe, expect, it, vi } from 'vitest';
import { startMatcherFills, streamsOf, type FillStreamClient } from './matcherFills.js';

// matcherFills.integration.test.ts runs the reader on a real Redis; this covers its failure
// paths on a scripted stand-in.

const fill = (userId: string, ltp: number): MatcherFill => ({
  v: 1,
  userId,
  token: 1,
  ltp,
  ts: '2026-09-28T04:30:00.000Z',
  orderIds: ['o1'],
  stopIds: [],
});
const entry = (id: string, value: MatcherFill) => [id, ['fill', JSON.stringify(value)]];

/** Answers each command from a script; an XREADGROUP with nothing scripted waits until closed. */
function scripted(reads: unknown[], options: { groupError?: string } = {}) {
  const calls: (string | number)[][] = [];
  let release: () => void = () => undefined;
  const client: FillStreamClient = {
    call: (command, ...args) => {
      calls.push([command, ...args]);
      if (command === 'XGROUP' && options.groupError) {
        return Promise.reject(new Error(options.groupError));
      }
      if (command === 'XREADGROUP') {
        if (reads.length > 0) {
          const next = reads.shift();
          return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
        }
        return new Promise((resolve) => {
          release = () => resolve(null);
        });
      }
      if (command === 'XAUTOCLAIM') return Promise.resolve(['0-0', [], []]);
      return Promise.resolve(1);
    },
    disconnect: () => release(),
  };
  const acks = () => calls.filter(([command]) => command === 'XACK').map((call) => call.at(-1));
  return { client, calls, acks };
}

describe('streamsOf', () => {
  it('reads RESP2 pairs and a RESP3 map alike', () => {
    const records = [['1-0', ['fill', '{}']]];
    expect(streamsOf([['k', records]])).toEqual([['k', records]]);
    expect(streamsOf(['k', records, 'j', []])).toEqual([
      ['k', records],
      ['j', []],
    ]);
    expect(streamsOf(null)).toEqual([]);
  });
});

describe('startMatcherFills (NSTOCK-0367)', () => {
  it("runs each user's requests in order, and leaves a failed one and its successors pending", async () => {
    const { client, acks } = scripted([
      [
        [
          'k0',
          [
            entry('1-0', fill('u1', 100)),
            entry('2-0', fill('u2', 100)),
            entry('3-0', fill('u1', 99)),
          ],
        ],
      ],
    ]);
    const seen: string[] = [];
    const warnings: string[] = [];
    const reader = startMatcherFills({
      orders: {
        applyMatcherFill: async (request) => {
          seen.push(`${request.userId}@${String(request.ltp)}`);
          if (request.userId === 'u1') throw new Error('database down');
        },
      },
      client,
      shards: 1,
      consumer: 'c1',
      log: { info: () => undefined, warn: (m) => warnings.push(m) },
      fillsKey: (shard) => `k${String(shard)}`,
    });
    await vi.waitFor(() => expect(acks()).toEqual(['2-0']));
    // u1's second request waits behind its failed first one.
    expect(seen.sort()).toEqual(['u1@100', 'u2@100']);
    expect(warnings).toEqual(['Matcher fill for u1 failed: database down']);
    await reader.close();
  });

  it('keeps a group that already exists, and retries a failed read', async () => {
    const { client, calls } = scripted([new Error('connection reset'), null], {
      groupError: 'BUSYGROUP Consumer Group name already exists',
    });
    const lines: string[] = [];
    const reader = startMatcherFills({
      orders: { applyMatcherFill: async () => undefined },
      client,
      shards: 2,
      consumer: 'c1',
      log: { info: (m) => lines.push(m), warn: (m) => lines.push(m) },
      blockMs: 10,
    });
    await reader.ready();
    await vi.waitFor(
      () => expect(calls.filter(([c]) => c === 'XREADGROUP').length).toBeGreaterThanOrEqual(3),
      { timeout: 5_000 },
    );
    expect(lines).toEqual([
      'Reading matcher fills failed: connection reset',
      'Reading matcher fills again',
    ]);
    expect(calls.filter(([c]) => c === 'XGROUP')).toHaveLength(2);
    await reader.close();
  });

  it('stops at once when another group error comes back', async () => {
    const { client } = scripted([], { groupError: 'NOPERM no permissions' });
    const lines: string[] = [];
    const reader = startMatcherFills({
      orders: { applyMatcherFill: async () => undefined },
      client,
      shards: 1,
      consumer: 'c1',
      log: { info: (m) => lines.push(m), warn: (m) => lines.push(m) },
    });
    await vi.waitFor(() =>
      expect(lines).toEqual(['Reading matcher fills failed: NOPERM no permissions']),
    );
    await reader.close();
    await reader.ready();
  });
});
