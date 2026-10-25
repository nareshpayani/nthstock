import { MatcherCommand, matcherCommandsKey, type Order } from '@nthstock/contracts';
import { shardOf } from '@nthstock/utils';
import { describe, expect, it } from 'vitest';
import { commandFor, startMatcherCommands, type CommandStream } from './matcherCommands.js';
import type { OrderUpdateListener } from './service.js';

const limit: Order = {
  id: 'pe_1',
  clientOrderId: null,
  token: 1594,
  symbol: 'INFY',
  exchange: 'NSE',
  side: 'SELL',
  type: 'LIMIT',
  product: 'DELIVERY',
  qty: 4,
  price: 1_500_00,
  filledQty: 0,
  avgFillPrice: null,
  status: 'OPEN',
  statusReason: null,
  validity: 'DAY',
  placedAt: '2026-09-28T04:30:00.000Z',
  updatedAt: '2026-09-28T04:30:00.000Z',
};

function fakeOrders() {
  const listeners = new Set<OrderUpdateListener>();
  return {
    onOrderUpdate(listener: OrderUpdateListener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    emit: (userId: string, order: Order, version: number) => {
      for (const listener of listeners) listener(userId, order, version);
    },
    listeners,
  };
}

function fakeStream() {
  const sent: { key: string; command: MatcherCommand }[] = [];
  let down = false;
  const stream: CommandStream = {
    xadd: async (key, _maxlen, _approx, _count, _id, _field, value) => {
      if (down) throw new Error('connection refused');
      sent.push({ key, command: MatcherCommand.parse(JSON.parse(value)) });
      return '1-0';
    },
  };
  return { stream, sent, setDown: (value: boolean) => (down = value) };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('commandFor (NSTOCK-0365)', () => {
  it('adds a new OPEN LIMIT order and modifies it after a change', () => {
    expect(commandFor('usr_a', limit, 3)).toEqual({
      v: 1,
      type: 'ADD',
      token: 1594,
      version: 3,
      orderId: 'pe_1',
      userId: 'usr_a',
      side: 'SELL',
      price: 1_500_00,
    });
    const partFilled = { ...limit, filledQty: 1, updatedAt: '2026-09-28T04:31:00.000Z' };
    expect(commandFor('usr_a', partFilled, 4)?.type).toBe('MODIFY');
    const repriced = { ...limit, price: 1_505_00, updatedAt: '2026-09-28T04:31:00.000Z' };
    expect(commandFor('usr_a', repriced, 5)).toMatchObject({ type: 'MODIFY', price: 1_505_00 });
  });

  it('cancels a LIMIT order in any other status, and ignores MARKET orders', () => {
    for (const status of ['EXECUTED', 'CANCELLED', 'REJECTED', 'AMO'] as const)
      expect(commandFor('usr_a', { ...limit, status }, 6)).toEqual({
        v: 1,
        type: 'CANCEL',
        token: 1594,
        version: 6,
        orderId: 'pe_1',
      });
    expect(commandFor('usr_a', { ...limit, type: 'MARKET', price: null }, 7)).toBeNull();
  });
});

describe('startMatcherCommands (NSTOCK-0365)', () => {
  it("sends each command to its instrument's shard and stops on request", async () => {
    const orders = fakeOrders();
    const { stream, sent } = fakeStream();
    const log = { info: () => undefined, warn: () => undefined };
    const running = startMatcherCommands({ orders, stream, shards: 4, log });

    orders.emit('usr_a', limit, 1);
    orders.emit('usr_a', { ...limit, type: 'MARKET', price: null }, 2);
    orders.emit('usr_b', { ...limit, id: 'pe_2', token: 2885 }, 3);
    await flush();
    expect(sent.map((s) => [s.key, s.command.version])).toEqual([
      [matcherCommandsKey(shardOf(1594, 4)), 1],
      [matcherCommandsKey(shardOf(2885, 4)), 3],
    ]);

    running.stop();
    running.stop();
    expect(orders.listeners.size).toBe(0);
  });

  it('logs a failing stream once, and again only after it recovered', async () => {
    const orders = fakeOrders();
    const { stream, sent, setDown } = fakeStream();
    const lines: string[] = [];
    const log = { info: (m: string) => lines.push(m), warn: (m: string) => lines.push(m) };
    startMatcherCommands({ orders, stream, shards: 1, log });

    setDown(true);
    orders.emit('usr_a', limit, 1);
    orders.emit('usr_a', limit, 2);
    await flush();
    setDown(false);
    orders.emit('usr_a', limit, 3);
    await flush();
    expect(sent.map((s) => s.command.version)).toEqual([3]);
    expect(lines).toEqual([
      'Matcher commands failed: connection refused',
      'Matcher commands recovered',
    ]);
  });
});
