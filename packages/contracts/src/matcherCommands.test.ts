import { describe, expect, it } from 'vitest';
import { MatcherCommand, matcherCommandsKey } from './matcherCommands.js';

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
