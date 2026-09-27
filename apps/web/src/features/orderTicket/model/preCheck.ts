import type { Instrument, InstrumentStats } from '@nthstock/contracts';
import { TICK_SIZE_PAISE } from '@nthstock/contracts';
import { validateOrder, type OrderRejectionCode } from '@nthstock/paperEngine';
import type { TicketFormValues } from './ticketForm';

export type PreCheckContext = {
  now: Date;
  instrument: Pick<Instrument, 'token' | 'symbol' | 'exchange'>;
  /** Today's circuit band; without stats the band is left to the server. */
  stats: Pick<InstrumentStats, 'lowerCircuit' | 'upperCircuit'> | undefined;
  /** Latest LTP in paise, to value a market order. */
  ltp: number | null;
  /** Available paper cash in paise; unknown (funds not loaded) is left to the server. */
  availableCash: number | undefined;
  /**
   * The mock market forced open at any hour (msw mode with VITE_MOCK_MARKET_OPEN): skip the
   * intraday hours check the clock would fail, as the rest of the UI treats the market as open.
   */
  forcedOpen: boolean;
};

/** Which form field a refusal belongs to; `form` for one shown above the button. */
export type PreCheckField = 'qty' | 'price' | 'form';

export type PreCheckResult =
  { ok: true } | { ok: false; code: OrderRejectionCode; field: PreCheckField; message: string };

const FIELD: Record<OrderRejectionCode, PreCheckField> = {
  INVALID_QTY: 'qty',
  PRICE_REQUIRED: 'price',
  PRICE_NOT_ALLOWED: 'price',
  PRICE_OFF_TICK: 'price',
  OUTSIDE_CIRCUIT: 'price',
  UNKNOWN_INSTRUMENT: 'form',
  ORDER_TOO_LARGE: 'qty',
  INTRADAY_MARKET_CLOSED: 'form',
  NO_PRICE: 'form',
  INSUFFICIENT_HOLDINGS: 'form',
  INSUFFICIENT_FUNDS: 'form',
};

/**
 * The paper engine's own rules (`validateOrder` from packages/paperEngine, T-127) run in the
 * browser before the review step, so the ticket refuses what the server would, with the same
 * words: circuit band, intraday hours, a price for a market order, enough cash for a buy. Holdings
 * are not loaded in the ticket, so a delivery sell is left to the server (its rejection shows
 * inline).
 */
export function preCheckOrder(values: TicketFormValues, ctx: PreCheckContext): PreCheckResult {
  const result = validateOrder(
    {
      token: ctx.instrument.token,
      side: values.side,
      type: values.type,
      // A forced-open mock market: check the rest as for delivery, which has no hours rule.
      product: ctx.forcedOpen ? 'DELIVERY' : values.product,
      qty: values.qty ?? 0,
      price: values.type === 'LIMIT' ? values.price : null,
    },
    {
      now: ctx.now,
      instrument: {
        token: ctx.instrument.token,
        symbol: ctx.instrument.symbol,
        exchange: ctx.instrument.exchange,
        lowerCircuit: ctx.stats?.lowerCircuit ?? TICK_SIZE_PAISE,
        upperCircuit: ctx.stats?.upperCircuit ?? Number.MAX_SAFE_INTEGER,
      },
      ltp: ctx.ltp,
      availableCash: ctx.availableCash ?? Number.MAX_SAFE_INTEGER,
      sellableQty: Number.MAX_SAFE_INTEGER,
    },
  );
  if (result.ok) return { ok: true };
  return { ok: false, code: result.code, field: FIELD[result.code], message: result.reason };
}
