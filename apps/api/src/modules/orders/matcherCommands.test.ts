import {
  MatcherCommand,
  matcherCommandsKey,
  type Order,
  type TrailingStop,
} from '@nthstock/contracts';
import { shardOf } from '@nthstock/utils';
import { describe, expect, it } from 'vitest';
import {
  commandFor,
  startMatcherCommands,
  stopCommandFor,
  type CommandStream,
} from './matcherCommands.js';
import type { OrderUpdateListener, TrailingStopUpdateListener } from './service.js';

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

const trailing: TrailingStop = {
  id: 'ts_1',
  token: 1594,
  symbol: 'INFY',
  exchange: 'NSE',
  product: 'DELIVERY',
  direction: 'LONG',
  trail: { unit: 'PERCENT', basisPoints: 200 },
  activationPrice: null,
  exitOrderType: 'MARKET',
  exitLimitOffset: null,
  status: 'TRAILING',
  statusReason: null,
  watermarkPrice: 1_500_00,
  stopPrice: 1_470_00,
  protectedQty: 4,
  entryOrderId: null,
  exitOrderId: null,
  seq: 2,
  createdAt: '2026-09-28T04:30:00.000Z',
  updatedAt: '2026-09-28T04:30:00.000Z',
};

function fakeOrders() {
  const listeners = new Set<OrderUpdateListener>();
  const stopListeners = new Set<TrailingStopUpdateListener>();
  return {
    onTrailingStopUpdate(listener: TrailingStopUpdateListener) {
      stopListeners.add(listener);
      return () => {
        stopListeners.delete(listener);
      };
    },
    emitStop: (userId: string, stop: TrailingStop, version: number) => {
      for (const listener of stopListeners) listener(userId, stop, version);
    },
    stopListeners,
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

describe('stopCommandFor (NSTOCK-0368)', () => {
  it('adds an ARMED or TRAILING stop with the state the matcher steps', () => {
    expect(stopCommandFor('usr_a', trailing, 5)).toEqual({
      v: 1,
      type: 'STOP_ADD',
      token: 1594,
      version: 5,
      stopId: 'ts_1',
      userId: 'usr_a',
      state: {
        status: 'TRAILING',
        direction: 'LONG',
        trail: { unit: 'PERCENT', basisPoints: 200 },
        activationPrice: null,
        watermarkPrice: 1_500_00,
        stopPrice: 1_470_00,
      },
    });
    const armed = { ...trailing, status: 'ARMED' as const, activationPrice: 1_520_00 };
    expect(stopCommandFor('usr_a', armed, 6)).toMatchObject({
      type: 'STOP_ADD',
      state: { status: 'ARMED', activationPrice: 1_520_00 },
    });
  });

  it('cancels a stop in any other status', () => {
    for (const status of [
      'PENDING_ENTRY',
      'TRIGGERED',
      'EXECUTED',
      'CANCELLED',
      'REJECTED',
    ] as const)
      expect(stopCommandFor('usr_a', { ...trailing, status }, 7)).toEqual({
        v: 1,
        type: 'STOP_CANCEL',
        token: 1594,
        version: 7,
        stopId: 'ts_1',
      });
  });
});

describe('startMatcherCommands (NSTOCK-0365)', () => {
  it("sends trailing stop changes to the instrument's shard (NSTOCK-0368)", async () => {
    const orders = fakeOrders();
    const { stream, sent } = fakeStream();
    const log = { info: () => undefined, warn: () => undefined };
    const running = startMatcherCommands({ orders, stream, shards: 4, log });

    orders.emitStop('usr_a', trailing, 1);
    orders.emitStop('usr_a', { ...trailing, status: 'CANCELLED' }, 2);
    await flush();
    expect(sent.map((s) => [s.key, s.command.type, s.command.version])).toEqual([
      [matcherCommandsKey(shardOf(1594, 4)), 'STOP_ADD', 1],
      [matcherCommandsKey(shardOf(1594, 4)), 'STOP_CANCEL', 2],
    ]);

    running.stop();
    expect(orders.stopListeners.size).toBe(0);
  });

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

  it('sends only the last update of an order that changed twice in one commit', async () => {
    const orders = fakeOrders();
    const { stream, sent } = fakeStream();
    const log = { info: () => undefined, warn: () => undefined };
    startMatcherCommands({ orders, stream, shards: 1, log });

    for (const listener of orders.listeners) {
      listener('usr_a', limit, 4, false);
      listener('usr_a', { ...limit, status: 'EXECUTED' }, 4, true);
    }
    await flush();
    expect(sent.map((s) => [s.command.type, s.command.version])).toEqual([['CANCEL', 4]]);
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
