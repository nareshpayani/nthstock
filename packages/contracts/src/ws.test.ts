import { describe, expect, it } from 'vitest';
import { quoteFixture, wsClientFixtures, wsServerFixtures } from './fixtures.js';
import {
  WS_CLOSE_CODES,
  WS_IDLE_TIMEOUT_MS,
  WS_MAX_SUBSCRIPTIONS,
  WS_PROTOCOL_VERSION,
  WsClientMessage,
  WsServerMessage,
} from './ws.js';

describe('WS protocol', () => {
  it('is version 1 with a 200-symbol cap', () => {
    expect(WS_PROTOCOL_VERSION).toBe(1);
    expect(WS_MAX_SUBSCRIPTIONS).toBe(200);
  });

  it('idles out after 60 s with an application close code', () => {
    expect(WS_IDLE_TIMEOUT_MS).toBe(60_000);
    expect(WS_CLOSE_CODES.idleTimeout).toBeGreaterThanOrEqual(4000);
    expect(WS_CLOSE_CODES.idleTimeout).toBeLessThan(5000);
  });

  it.each(wsClientFixtures.map((m) => [m.type, m] as const))(
    'parses client %s',
    (_type, message) => {
      expect(WsClientMessage.parse(JSON.parse(JSON.stringify(message)))).toEqual(message);
    },
  );

  it.each(wsServerFixtures.map((m) => [m.type, m] as const))(
    'parses server %s',
    (_type, message) => {
      expect(WsServerMessage.parse(JSON.parse(JSON.stringify(message)))).toEqual(message);
    },
  );

  it('rejects an unknown type', () => {
    expect(WsClientMessage.safeParse({ v: 1, type: 'hello' }).success).toBe(false);
    expect(WsServerMessage.safeParse({ v: 1, type: 'hello' }).success).toBe(false);
    expect(WsServerMessage.safeParse({ v: 1, type: 'subscribe', symbols: ['INFY'] }).success).toBe(
      false,
    );
  });

  it('rejects a missing or different protocol version', () => {
    expect(WsClientMessage.safeParse({ type: 'ping', id: 1 }).success).toBe(false);
    expect(WsClientMessage.safeParse({ v: 2, type: 'ping', id: 1 }).success).toBe(false);
  });

  it('defaults the subscription exchange to NSE', () => {
    expect(WsClientMessage.parse({ v: 1, type: 'subscribe', symbols: ['INFY'] })).toEqual({
      v: 1,
      type: 'subscribe',
      symbols: ['INFY'],
      exchange: 'NSE',
    });
  });

  it('rejects lowercase, empty or oversized subscriptions', () => {
    expect(WsClientMessage.safeParse({ v: 1, type: 'subscribe', symbols: ['infy'] }).success).toBe(
      false,
    );
    expect(WsClientMessage.safeParse({ v: 1, type: 'subscribe', symbols: [] }).success).toBe(false);
    const symbols = Array.from({ length: 201 }, (_, i) => `S${i}`);
    expect(WsClientMessage.safeParse({ v: 1, type: 'subscribe', symbols }).success).toBe(false);
  });

  it('rejects a quotes frame with float paise', () => {
    expect(
      WsServerMessage.safeParse({ v: 1, type: 'quotes', quotes: [{ ...quoteFixture, ltp: 1.5 }] })
        .success,
    ).toBe(false);
  });
});
