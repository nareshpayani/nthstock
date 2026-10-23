import { z } from 'zod';
import { Seq } from './primitives.js';
import { Order } from './orders.js';
import { FundsSummary, Position } from './portfolio.js';
import { TrailingStop } from './trailingStops.js';

/**
 * `GET /v1/account/state`: the signed-in account's trading state at one engine `seq` (ADR 0012).
 * The trading store loads it on start, after a gap in `accountDelta` frames and on resume, then
 * applies frames with a higher `seq` on top. Orders are today's and the working ones; positions
 * and trailing stops are today's.
 */
export const AccountState = z.object({
  seq: Seq,
  orders: z.array(Order),
  positions: z.array(Position),
  trailingStops: z.array(TrailingStop),
  funds: FundsSummary,
});
export type AccountState = z.infer<typeof AccountState>;
