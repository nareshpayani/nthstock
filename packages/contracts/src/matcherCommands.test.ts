import { describe, expect, it } from 'vitest';
import {
  MatcherCommand,
  MatcherFill,
  matcherCommandsKey,
  matcherFillsKey,
} from './matcherCommands.js';

const order = {
  v: 1,
  token: 1594,
  version: 7,
  orderId: 'pe_1',
  userId: 'u_1',
  side: 'BUY',
  price: 1_500_05,
};

describe('MatcherCommand (NSTOCK-0365)', () => {
  it('reads every command type', () => {
    const commands = [
      { ...order, type: 'ADD' },
      { ...order, type: 'MODIFY' },
      { v: 1, token: 1594, version: 8, type: 'CANCEL', orderId: 'pe_1' },
      {
        v: 1,
        token: 1594,
        version: 9,
        type: 'STOP_ADD',
        stopId: 'ts_1',
        userId: 'u_1',
        state: {
          status: 'ARMED',
          direction: 'LONG',
          trail: { unit: 'AMOUNT', amount: 10_00 },
          activationPrice: null,
          watermarkPrice: null,
          stopPrice: null,
        },
      },
      { v: 1, token: 1594, version: 10, type: 'STOP_CANCEL', stopId: 'ts_1' },
    ];
    for (const command of commands) expect(MatcherCommand.parse(command)).toEqual(command);
  });

  it('refuses a price off the 5-paise tick, an unknown type and another version', () => {
    expect(MatcherCommand.safeParse({ ...order, type: 'ADD', price: 1_500_03 }).success).toBe(
      false,
    );
    expect(MatcherCommand.safeParse({ ...order, type: 'FILL' }).success).toBe(false);
    expect(MatcherCommand.safeParse({ ...order, type: 'ADD', v: 2 }).success).toBe(false);
  });

  it('keys a stream per shard', () => {
    expect(matcherCommandsKey(3)).toBe('nthstock:matcher:commands:v1:3');
  });
});

describe('MatcherFill (NSTOCK-0367)', () => {
  const fill = {
    v: 1,
    userId: 'u_1',
    token: 1594,
    ltp: 1_500_00,
    ts: '2026-09-28T04:30:00.250Z',
    orderIds: ['pe_1'],
    stopIds: [],
  };

  it('reads a fill and keys a stream per shard', () => {
    expect(MatcherFill.parse(fill)).toEqual(fill);
    expect(matcherFillsKey(0)).toBe('nthstock:matcher:fills:v1:0');
  });

  it('refuses a local time and a price that is not positive', () => {
    expect(MatcherFill.safeParse({ ...fill, ts: '2026-09-28T10:00:00+05:30' }).success).toBe(false);
    expect(MatcherFill.safeParse({ ...fill, ltp: 0 }).success).toBe(false);
  });
});
