import { describe, expect, it } from 'vitest';
import {
  ORDER_UPDATE_EVENT_VERSION,
  ORDER_UPDATES_CHANNEL_PREFIX,
  OrderUpdateEvent,
  TICK_BATCH_VERSION,
  TICKS_CHANNEL,
  TickBatch,
  TickStreamEntry,
  quoteSnapshotKey,
  tickStreamKey,
  tickStreamStep,
  SESSION_REVOKED_EVENT_VERSION,
  SessionRevokedEvent,
  orderUpdatesChannel,
  sessionRevokedChannel,
  sessionRevokedKey,
} from './pubsub.js';

const quote = {
  token: 1,
  symbol: 'INFY',
  exchange: 'NSE',
  ltp: 150_000,
  change: 500,
  changeBp: 33,
  open: 149_500,
  high: 150_500,
  low: 149_000,
  prevClose: 149_500,
  volume: 1_000,
  ts: '2026-09-25T04:00:00.000Z',
};

describe('TickBatch', () => {
  it('names a versioned channel', () => {
    expect(TICKS_CHANNEL).toMatch(/:v1$/);
  });

  it('accepts a batch of quotes and rejects an empty or unversioned one', () => {
    expect(TickBatch.parse({ v: TICK_BATCH_VERSION, quotes: [quote] }).quotes).toHaveLength(1);
    expect(TickBatch.safeParse({ v: TICK_BATCH_VERSION, quotes: [] }).success).toBe(false);
    expect(TickBatch.safeParse({ quotes: [quote] }).success).toBe(false);
  });
});

describe('OrderUpdateEvent', () => {
  const order = {
    id: 'ord_1',
    clientOrderId: null,
    token: 1,
    symbol: 'INFY',
    exchange: 'NSE',
    side: 'BUY',
    type: 'LIMIT',
    product: 'DELIVERY',
    qty: 10,
    price: 149_000,
    filledQty: 10,
    avgFillPrice: 149_000,
    status: 'EXECUTED',
    statusReason: null,
    validity: 'DAY',
    placedAt: '2026-09-25T04:00:00.000Z',
    updatedAt: '2026-09-25T04:00:01.000Z',
  };

  it('names one versioned channel per user and refuses an id that could escape it', () => {
    expect(orderUpdatesChannel('usr_a')).toBe(`${ORDER_UPDATES_CHANNEL_PREFIX}usr_a`);
    expect(ORDER_UPDATES_CHANNEL_PREFIX).toMatch(/:v1:$/);
    expect(() => orderUpdatesChannel('a:*')).toThrow();
  });

  it('carries the user and a contract order', () => {
    const event = { v: ORDER_UPDATE_EVENT_VERSION, userId: 'usr_a', order };
    expect(OrderUpdateEvent.parse(event)).toEqual(event);
    expect(OrderUpdateEvent.safeParse({ ...event, userId: undefined }).success).toBe(false);
    expect(OrderUpdateEvent.safeParse({ ...event, order: { ...order, qty: 0 } }).success).toBe(
      false,
    );
  });
});

describe('SessionRevokedEvent (T-194)', () => {
  it('names a versioned channel and a per-session key in a namespace', () => {
    expect(sessionRevokedChannel()).toBe('nthstock:auth:sessionRevoked:v1');
    expect(sessionRevokedChannel('test:1:')).toBe('test:1:auth:sessionRevoked:v1');
    expect(sessionRevokedKey('ses_1')).toBe('nthstock:sess:revoked:ses_1');
    expect(sessionRevokedKey('ses_1', 'test:1:')).toBe('test:1:sess:revoked:ses_1');
    expect(() => sessionRevokedKey('ses:*')).toThrow();
  });

  it('carries the session and its user, versioned', () => {
    const event = { v: SESSION_REVOKED_EVENT_VERSION, sessionId: 'ses_1', userId: 'usr_a' };
    expect(SessionRevokedEvent.parse(event)).toEqual(event);
    expect(SessionRevokedEvent.safeParse({ ...event, v: 2 }).success).toBe(false);
    expect(SessionRevokedEvent.safeParse({ ...event, sessionId: 'a b' }).success).toBe(false);
  });
});

describe('tick streams (spec market-data-and-matching §4)', () => {
  it('names one stream and one snapshot per shard', () => {
    expect(tickStreamKey(0)).toBe('nthstock:ticks:v1:0');
    expect(quoteSnapshotKey(3)).toBe('nthstock:quotes:last:v1:3');
  });

  it('applies the next entry and resyncs after a gap, a restart or a fresh start', () => {
    expect(tickStreamStep(41, { seq: 42 })).toBe('apply');
    expect(tickStreamStep(41, { seq: 44 })).toBe('resync'); // trimmed or missed
    expect(tickStreamStep(41, { seq: 1 })).toBe('resync'); // the writer restarted
    expect(tickStreamStep(null, { seq: 7 })).toBe('resync'); // nothing applied yet
  });

  it('parses an entry with its shard and seq', () => {
    const entry = { v: 1, shard: 0, seq: 1, quotes: [quote] };
    expect(TickStreamEntry.parse(entry)).toEqual(entry);
    expect(TickStreamEntry.safeParse({ ...entry, seq: 0 }).success).toBe(false);
    expect(TickStreamEntry.safeParse({ ...entry, quotes: [] }).success).toBe(false);
  });
});
