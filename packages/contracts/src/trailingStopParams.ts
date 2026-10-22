import { z } from 'zod';
import { NonNegativePaise, Paise, TICK_SIZE_PAISE, TickPrice } from './primitives.js';

/**
 * What a user chooses when placing a trailing stop (SPEC-TFC-1 §6.1). Kept apart from
 * `trailingStops.ts` so `orders.ts` can attach these params to an entry without an import cycle.
 */

/** Trail limits from SPEC-TFC-1 §6.6, shared by the engine (authoritative), ticket and chart. */
export const TRAILING_STOP_LIMITS = {
  /** The smallest effective trail: one tick, ₹0.05. */
  minTrailPaise: TICK_SIZE_PAISE,
  /** 0.10%. */
  minTrailBasisPoints: 10,
  /** 20.00%; a rupee trail is also capped at this share of the LTP. */
  maxTrailBasisPoints: 2_000,
} as const;

/**
 * The user-facing validation messages of SPEC-TFC-1 §6.6, word for word. The engine returns them
 * and the ticket and chart show them as the user types or drags, so every surface says the same.
 * Amounts arrive already formatted as rupees (for example `₹48.20`).
 */
export const TRAILING_STOP_MESSAGES = {
  noPosition: 'Open a position first. A trailing stop protects an existing position.',
  trailNotPositive: 'Enter a trail greater than zero.',
  trailBelowTick: 'The trail must be at least ₹0.05.',
  trailAboveMaxAmount: (maxRupees: string) =>
    `The trail can be at most 20% of the price (${maxRupees}).`,
  trailPercentOutOfRange: 'Enter a trail between 0.10% and 20%.',
  stopWouldTrigger: 'That stop would trigger immediately.',
  limitOffsetTooLarge: 'The limit offset is too large for this stop.',
  limitOffsetRequired: 'Enter a limit offset',
  limitOffsetOnMarketExit: 'A market exit has no limit offset',
} as const;

/**
 * The distance the stop keeps from the best price since activation: a fixed amount in paise, or
 * a percentage of that best price in whole basis points (1% = 100 bp). The user picks one unit.
 */
export const Trail = z.discriminatedUnion('unit', [
  z.object({
    unit: z.literal('AMOUNT'),
    amount: Paise.positive({ error: TRAILING_STOP_MESSAGES.trailNotPositive }),
  }),
  z.object({
    unit: z.literal('PERCENT'),
    basisPoints: z
      .number()
      .int({ error: TRAILING_STOP_MESSAGES.trailPercentOutOfRange })
      .min(TRAILING_STOP_LIMITS.minTrailBasisPoints, {
        error: TRAILING_STOP_MESSAGES.trailPercentOutOfRange,
      })
      .max(TRAILING_STOP_LIMITS.maxTrailBasisPoints, {
        error: TRAILING_STOP_MESSAGES.trailPercentOutOfRange,
      }),
  }),
]);
export type Trail = z.infer<typeof Trail>;

/** How the position is closed when the stop triggers. Market by default. */
export const TrailingStopExitType = z.enum(['MARKET', 'LIMIT']);
export type TrailingStopExitType = z.infer<typeof TrailingStopExitType>;

/** A limit exit's distance beyond the stop, in paise on the 5-paise tick (zero allowed). */
export const ExitLimitOffset = NonNegativePaise.multipleOf(TICK_SIZE_PAISE, {
  error: `Offset must be a multiple of ${TICK_SIZE_PAISE} paise`,
});
export type ExitLimitOffset = z.infer<typeof ExitLimitOffset>;

/** The fields of `TrailingStopParams`, for request schemas that add their own. */
export const trailingStopParamsShape = {
  trail: Trail,
  /** The trail starts once the LTP reaches this price; null starts it at once. */
  activationPrice: TickPrice.nullable().default(null),
  exitOrderType: TrailingStopExitType.default('MARKET'),
  /**
   * Limit exits only: the exit limit is `stopPrice − offset` for a long position and
   * `stopPrice + offset` for a short one. Null for a market exit.
   */
  exitLimitOffset: ExitLimitOffset.nullable().default(null),
};

type ExitFields = {
  exitOrderType?: TrailingStopExitType | undefined;
  exitLimitOffset?: number | null | undefined;
};

/** A limit exit needs an offset; a market exit must not carry one. */
export const checkExitFields = (value: ExitFields, ctx: z.RefinementCtx) => {
  if (value.exitOrderType === 'LIMIT' && (value.exitLimitOffset ?? null) === null) {
    ctx.addIssue({
      code: 'custom',
      path: ['exitLimitOffset'],
      message: TRAILING_STOP_MESSAGES.limitOffsetRequired,
    });
  }
  if (value.exitOrderType !== 'LIMIT' && value.exitLimitOffset != null) {
    ctx.addIssue({
      code: 'custom',
      path: ['exitLimitOffset'],
      message: TRAILING_STOP_MESSAGES.limitOffsetOnMarketExit,
    });
  }
};

/**
 * A trailing stop's user-chosen parameters. Rules that need the market (a rupee trail above 20% of
 * the LTP, an effective trail below one tick, an offset too large for the stop) are checked by
 * the engine's `validateTrailingStop`, which uses `TRAILING_STOP_MESSAGES` too.
 */
export const TrailingStopParams = z.object(trailingStopParamsShape).superRefine(checkExitFields);
export type TrailingStopParams = z.infer<typeof TrailingStopParams>;
