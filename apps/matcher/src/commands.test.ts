import { MATCHER_COMMAND_VERSION, type MatcherCommand } from '@nthstock/contracts';
import { OrderBook } from '@nthstock/paperEngine';
import { describe, expect, it, vi } from 'vitest';
import { applyCommand, readMatcherCommands, type CommandStreamClient } from './commands.js';

const v = MATCHER_COMMAND_VERSION;
const add = (version: number, price: number, type: 'ADD' | 'MODIFY' = 'ADD'): MatcherCommand => ({
  v,
  type,
  token: 1,
  version,
  orderId: 'o1',
  userId: 'u1',
  side: 'BUY',
  price,
});

describe('applyCommand (NSTOCK-0365)', () => {
  it('adds, modifies and cancels an order by version', () => {
    const book = new OrderBook();
    expect(applyCommand(book, add(1, 100_00))).toBe(true);
    expect(applyCommand(book, add(3, 99_00, 'MODIFY'))).toBe(true);
    // A late command older than the modify changes nothing.
    expect(applyCommand(book, add(2, 101_00, 'MODIFY'))).toBe(false);
    expect(book.tick(100_00).crossed).toEqual([]);
    expect(applyCommand(book, { v, type: 'CANCEL', token: 1, version: 4, orderId: 'o1' })).toBe(
      true,
    );
    expect(book.tick(90_00).crossed).toEqual([]);
  });

  it('adds and cancels a trailing stop', () => {
    const book = new OrderBook();
    const stop: MatcherCommand = {
      v,
      type: 'STOP_ADD',
      token: 1,
      version: 1,
      stopId: 's1',
      userId: 'u1',
      state: {
        status: 'TRAILING',
        direction: 'LONG',
        trail: { unit: 'AMOUNT', amount: 5_00 },
        activationPrice: null,
        watermarkPrice: 100_00,
        stopPrice: 95_00,
      },
    };
    expect(applyCommand(book, stop)).toBe(true);
    expect(book.hasStop('s1')).toBe(true);
    expect(applyCommand(book, { v, type: 'STOP_CANCEL', token: 1, version: 2, stopId: 's1' })).toBe(
      true,
    );
    expect(book.size.stops).toBe(0);
  });
});

/** An XREAD stand-in: each call takes the next scripted answer, or waits until closed. */
function scriptedClient(answers: (() => unknown)[]) {
  const calls: (string | number)[][] = [];
  let release: () => void = () => undefined;
  const client: CommandStreamClient = {
    xread: (...args) => {
      calls.push(args);
      const next = answers.shift();
      if (next) return Promise.resolve().then(next);
      return new Promise((resolve) => {
        release = () => resolve(null);
      });
    },
    disconnect: () => release(),
  };
  return { client, calls };
}

const entry = (id: string, command: unknown) => [id, ['command', JSON.stringify(command)]];

describe('applyCommand: price alerts (NSTOCK-0383)', () => {
  it('adds an alert once and cancels it', () => {
    const book = new OrderBook();
    const alertAdd: MatcherCommand = {
      v,
      type: 'ALERT_ADD',
      token: 1,
      version: 0,
      alertId: 'a1',
      userId: 'u1',
      condition: 'BELOW',
      price: 90_00,
    };
    expect(applyCommand(book, alertAdd)).toBe(true);
    expect(applyCommand(book, alertAdd)).toBe(false);
    expect(book.hasAlert('a1')).toBe(true);
    const cancel: MatcherCommand = { v, type: 'ALERT_CANCEL', token: 1, version: 0, alertId: 'a1' };
    expect(applyCommand(book, cancel)).toBe(true);
    expect(applyCommand(book, cancel)).toBe(false);
    expect(book.hasAlert('a1')).toBe(false);
  });
});

describe('readMatcherCommands (NSTOCK-0365)', () => {
  it('reads from the newest entry on, drops malformed entries and moves its cursor', async () => {
    const { client, calls } = scriptedClient([
      () => [
        [
          'k',
          [
            entry('1-0', add(1, 100_00)),
            ['2-0', ['command', '{not json']],
            entry('3-0', { ...add(2, 100_00), v: 99 }),
            ['4-0', ['other', 'x']],
            entry('5-0', add(3, 99_00)),
          ],
        ],
      ],
    ]);
    const warnings: unknown[] = [];
    const seen: MatcherCommand[] = [];
    const reader = readMatcherCommands({
      client,
      shard: 2,
      onCommand: (command) => seen.push(command),
      log: { info: () => undefined, warn: (_m, fields) => warnings.push(fields) },
      commandsKey: (shard) => `k${String(shard)}`,
    });
    await reader.ready();
    await vi.waitFor(() => expect(calls).toHaveLength(2));
    expect(seen.map((c) => c.version)).toEqual([1, 3]);
    expect(warnings).toHaveLength(3);
    expect(calls[0]).toEqual(['COUNT', 500, 'BLOCK', 5_000, 'STREAMS', 'k2', '$']);
    expect(calls[1]?.at(-1)).toBe('5-0');
    await reader.close();
  });

  it('keeps applying the rest of a batch when onCommand throws on one entry', async () => {
    const { client, calls } = scriptedClient([
      () => [['k', [entry('1-0', add(1, 100_00)), entry('2-0', add(2, 99_00))]]],
    ]);
    const warnings: { message: string; fields: unknown }[] = [];
    const seen: number[] = [];
    const reader = readMatcherCommands({
      client,
      shard: 3,
      onCommand: (command) => {
        if (command.version === 1) throw new Error('book exploded');
        seen.push(command.version);
      },
      log: {
        info: () => undefined,
        warn: (message, fields) => warnings.push({ message, fields }),
      },
      commandsKey: () => 'k',
    });
    await vi.waitFor(() => expect(calls).toHaveLength(2));
    expect(seen).toEqual([2]);
    expect(calls[1]?.at(-1)).toBe('2-0');
    expect(warnings).toEqual([
      {
        message: 'Dropped a matcher command that failed to apply',
        fields: expect.objectContaining({
          shard: 3,
          id: '1-0',
          type: 'ADD',
          orderId: 'o1',
        }) as unknown,
      },
    ]);
    await reader.close();
  });

  it('logs a failed read once and retries', async () => {
    const fail = () => {
      throw new Error('connection refused');
    };
    const { client, calls } = scriptedClient([fail, fail, () => null]);
    const lines: string[] = [];
    const reader = readMatcherCommands({
      client,
      shard: 0,
      onCommand: () => undefined,
      log: { info: (m) => lines.push(m), warn: (m) => lines.push(m) },
    });
    await vi.waitFor(() => expect(calls.length).toBeGreaterThanOrEqual(4), { timeout: 5_000 });
    expect(lines).toEqual(['Reading matcher commands failed', 'Reading matcher commands again']);
    await reader.close();
  });
});
