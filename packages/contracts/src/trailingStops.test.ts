import { describe, expect, it } from 'vitest';
import { AccountState } from './account.js';
import {
  accountStateFixture,
  modifyTrailingStopFixture,
  placeLimitFixture,
  placeTrailingStopFixture,
  trailingStopFixture,
} from './fixtures.js';
import { PlaceOrderRequest } from './orders.js';
import {
  TRAILING_STOP_LIMITS,
  TRAILING_STOP_MESSAGES,
  Trail,
  TrailingStopParams,
} from './trailingStopParams.js';
import {
  ModifyTrailingStopRequest,
  PlaceTrailingStopRequest,
  TERMINAL_TRAILING_STOP_STATUSES,
  TrailingStop,
  TrailingStopStatus,
  TrailingStopsResponse,
} from './trailingStops.js';

const messages = (result: { error?: { issues: { message: string }[] } | undefined }) =>
  result.error?.issues.map((i) => i.message) ?? [];

describe('trailing-stop fixtures round-trip', () => {
  it.each([
    ['PlaceTrailingStopRequest', PlaceTrailingStopRequest, placeTrailingStopFixture],
    ['ModifyTrailingStopRequest', ModifyTrailingStopRequest, modifyTrailingStopFixture],
    ['TrailingStop', TrailingStop, trailingStopFixture],
    ['TrailingStopsResponse', TrailingStopsResponse, { items: [trailingStopFixture] }],
    ['AccountState', AccountState, accountStateFixture],
  ] as const)('%s', (_name, schema, fixture) => {
    expect(schema.parse(JSON.parse(JSON.stringify(fixture)))).toEqual(fixture);
  });
});

describe('TrailingStopStatus', () => {
  it('follows the SPEC-TFC-1 §6.2 lifecycle', () => {
    expect(TrailingStopStatus.options).toEqual([
      'PENDING_ENTRY',
      'ARMED',
      'TRAILING',
      'TRIGGERED',
      'EXECUTED',
      'CANCELLED',
      'REJECTED',
    ]);
    expect(TERMINAL_TRAILING_STOP_STATUSES).toEqual(['EXECUTED', 'CANCELLED', 'REJECTED']);
  });
});

describe('Trail', () => {
  it('takes a rupee amount or whole basis points', () => {
    expect(Trail.parse({ unit: 'AMOUNT', amount: 5 })).toEqual({ unit: 'AMOUNT', amount: 5 });
    expect(Trail.parse({ unit: 'PERCENT', basisPoints: 150 })).toEqual({
      unit: 'PERCENT',
      basisPoints: 150,
    });
  });

  it('refuses a trail of zero or less with the §6.6 message', () => {
    for (const amount of [0, -5]) {
      expect(messages(Trail.safeParse({ unit: 'AMOUNT', amount }))).toEqual([
        TRAILING_STOP_MESSAGES.trailNotPositive,
      ]);
    }
  });

  it('keeps a percent trail between 0.10% and 20% in whole basis points', () => {
    const { minTrailBasisPoints: min, maxTrailBasisPoints: max } = TRAILING_STOP_LIMITS;
    expect(Trail.safeParse({ unit: 'PERCENT', basisPoints: min }).success).toBe(true);
    expect(Trail.safeParse({ unit: 'PERCENT', basisPoints: max }).success).toBe(true);
    for (const basisPoints of [min - 1, max + 1, 150.5]) {
      expect(messages(Trail.safeParse({ unit: 'PERCENT', basisPoints }))).toEqual([
        TRAILING_STOP_MESSAGES.trailPercentOutOfRange,
      ]);
    }
  });

  it('refuses a percent trail sent with an amount field only', () => {
    expect(Trail.safeParse({ unit: 'PERCENT', amount: 500 }).success).toBe(false);
  });
});

describe('TrailingStopParams', () => {
  it('defaults to a market exit that trails at once', () => {
    expect(TrailingStopParams.parse({ trail: { unit: 'AMOUNT', amount: 500 } })).toEqual({
      trail: { unit: 'AMOUNT', amount: 500 },
      activationPrice: null,
      exitOrderType: 'MARKET',
      exitLimitOffset: null,
    });
  });

  it('needs an offset for a limit exit and refuses one on a market exit', () => {
    const trail = { unit: 'AMOUNT', amount: 500 } as const;
    expect(messages(TrailingStopParams.safeParse({ trail, exitOrderType: 'LIMIT' }))).toEqual([
      TRAILING_STOP_MESSAGES.limitOffsetRequired,
    ]);
    expect(
      messages(
        TrailingStopParams.safeParse({ trail, exitOrderType: 'MARKET', exitLimitOffset: 5 }),
      ),
    ).toEqual([TRAILING_STOP_MESSAGES.limitOffsetOnMarketExit]);
    expect(
      TrailingStopParams.safeParse({ trail, exitOrderType: 'LIMIT', exitLimitOffset: 0 }).success,
    ).toBe(true);
  });

  it('keeps the activation price and offset on the 5-paise tick', () => {
    const trail = { unit: 'AMOUNT', amount: 500 } as const;
    expect(TrailingStopParams.safeParse({ trail, activationPrice: 152_342 }).success).toBe(false);
    expect(
      TrailingStopParams.safeParse({ trail, exitOrderType: 'LIMIT', exitLimitOffset: 7 }).success,
    ).toBe(false);
  });
});

describe('PlaceTrailingStopRequest', () => {
  it('names the position by instrument and product', () => {
    const withoutToken: Record<string, unknown> = { ...placeTrailingStopFixture };
    delete withoutToken.token;
    expect(PlaceTrailingStopRequest.safeParse(withoutToken).success).toBe(false);
  });

  it('applies the exit rules too', () => {
    expect(
      messages(
        PlaceTrailingStopRequest.safeParse({ ...placeTrailingStopFixture, exitOrderType: 'LIMIT' }),
      ),
    ).toEqual([TRAILING_STOP_MESSAGES.limitOffsetRequired]);
  });
});

describe('ModifyTrailingStopRequest', () => {
  it('needs at least one change', () => {
    expect(messages(ModifyTrailingStopRequest.safeParse({}))).toEqual(['Nothing to change']);
  });

  it('takes a trail or a dragged stop price, never both', () => {
    expect(ModifyTrailingStopRequest.safeParse({ stopPrice: 152_500 }).success).toBe(true);
    expect(
      messages(
        ModifyTrailingStopRequest.safeParse({
          stopPrice: 152_500,
          trail: { unit: 'AMOUNT', amount: 500 },
        }),
      ),
    ).toEqual(['Send a trail or a stop price, not both']);
  });

  it('checks the exit fields only when the exit type changes', () => {
    expect(ModifyTrailingStopRequest.safeParse({ exitLimitOffset: 10 }).success).toBe(true);
    expect(messages(ModifyTrailingStopRequest.safeParse({ exitOrderType: 'LIMIT' }))).toEqual([
      TRAILING_STOP_MESSAGES.limitOffsetRequired,
    ]);
  });
});

describe('attached trailing stop on an entry', () => {
  it('is optional and parsed with the same rules', () => {
    const attached = PlaceOrderRequest.parse({
      ...placeLimitFixture,
      attachedTrailingStop: { trail: { unit: 'PERCENT', basisPoints: 100 } },
    });
    expect(attached.attachedTrailingStop).toEqual({
      trail: { unit: 'PERCENT', basisPoints: 100 },
      activationPrice: null,
      exitOrderType: 'MARKET',
      exitLimitOffset: null,
    });
    expect(
      PlaceOrderRequest.safeParse({
        ...placeLimitFixture,
        attachedTrailingStop: { trail: { unit: 'AMOUNT', amount: 0 } },
      }).success,
    ).toBe(false);
  });
});
