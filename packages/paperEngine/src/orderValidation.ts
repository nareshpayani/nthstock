import {
  TICK_SIZE_PAISE,
  type InstrumentToken,
  type OrderSide,
  type OrderType,
  type ProductType,
} from '@nthstock/contracts';
import {
  INTRADAY_SQUARE_OFF,
  formatInr,
  getMarketStatus,
  nseHolidays2026,
  toIstParts,
  type HolidayTable,
} from '@nthstock/utils';
import type { InstrumentInfo } from './instruments.js';

/** The order fields validation looks at. `price` is the limit in paise; `null` for MARKET. */
export type OrderDraft = {
  token: InstrumentToken;
  side: OrderSide;
  type: OrderType;
  product: ProductType;
  qty: number;
  price: number | null;
};

/** Everything outside the order that the rules depend on. The caller reads it from engine state. */
export type ValidationContext = {
  now: Date;
  /** Defaults to the NSE 2026 table. */
  holidays?: HolidayTable;
  instrument: InstrumentInfo | null;
  /** LTP in paise, or `null` when there is no price yet. */
  ltp: number | null;
  /** Cash this order may use: available cash plus anything the order already has blocked. */
  availableCash: number;
  /**
   * Shares this order may sell for delivery: holdings plus today's delivery buys, less what other
   * pending delivery SELL orders already cover.
   */
  sellableQty: number;
};

/**
 * Why an order was refused. The first group are malformed requests (the order is never stored);
 * the rest are risk checks, which store the order as REJECTED with the reason.
 */
export type OrderRejectionCode =
  | 'INVALID_QTY'
  | 'PRICE_REQUIRED'
  | 'PRICE_NOT_ALLOWED'
  | 'PRICE_OFF_TICK'
  | 'UNKNOWN_INSTRUMENT'
  | 'ORDER_TOO_LARGE'
  | 'INTRADAY_MARKET_CLOSED'
  | 'NO_PRICE'
  | 'OUTSIDE_CIRCUIT'
  | 'INSUFFICIENT_HOLDINGS'
  | 'INSUFFICIENT_FUNDS';

const REQUEST_ERRORS: ReadonlySet<OrderRejectionCode> = new Set([
  'INVALID_QTY',
  'PRICE_REQUIRED',
  'PRICE_NOT_ALLOWED',
  'PRICE_OFF_TICK',
  'UNKNOWN_INSTRUMENT',
]);

/** True for a malformed request that cannot become an `Order` record at all. */
export function isRequestError(code: OrderRejectionCode): boolean {
  return REQUEST_ERRORS.has(code);
}

export type ValidationResult =
  | {
      ok: true;
      /** Cash to block for this order in paise: qty × limit (or × LTP for MARKET); 0 for a SELL. */
      blockAmount: number;
    }
  | { ok: false; code: OrderRejectionCode; reason: string };

function fail(code: OrderRejectionCode, reason: string): ValidationResult {
  return { ok: false, code, reason };
}

/** True while new intraday orders are allowed: market open and before the 15:20 IST square-off. */
export function intradayWindowOpen(now: Date, holidays: HolidayTable = nseHolidays2026): boolean {
  const status = getMarketStatus({ now: () => now }, holidays);
  return status.state === 'open' && toIstParts(now).minuteOfDay < INTRADAY_SQUARE_OFF;
}

/**
 * Checks an order against the paper-trading rules (T-127) and returns the first failure, with a
 * plain-language reason the UI can show as is, or the cash to block. Pure: it reads nothing but
 * its arguments.
 *
 * Rules, in order: whole-number quantity ≥ 1; a limit price for LIMIT and none for MARKET; the
 * price on the 5-paise tick; a known instrument; intraday only in market hours (9:15 AM to the
 * 3:20 PM square-off); a price to value a MARKET order; a LIMIT price inside today's circuit band;
 * enough holdings for a delivery SELL; enough cash for a BUY.
 */
export function validateOrder(order: OrderDraft, ctx: ValidationContext): ValidationResult {
  if (!Number.isSafeInteger(order.qty) || order.qty < 1) {
    return fail('INVALID_QTY', 'Quantity must be a whole number of shares, at least 1.');
  }
  if (order.type === 'LIMIT' && order.price === null) {
    return fail('PRICE_REQUIRED', 'Enter a limit price for a limit order.');
  }
  if (order.type === 'MARKET' && order.price !== null) {
    return fail('PRICE_NOT_ALLOWED', 'A market order has no price; it fills at the market price.');
  }
  if (
    order.price !== null &&
    (!Number.isSafeInteger(order.price) || order.price <= 0 || order.price % TICK_SIZE_PAISE !== 0)
  ) {
    return fail(
      'PRICE_OFF_TICK',
      `Price must be a positive multiple of ${String(TICK_SIZE_PAISE)} paise, like ₹100.05 or ₹100.10.`,
    );
  }
  const instrument = ctx.instrument;
  if (!instrument) return fail('UNKNOWN_INSTRUMENT', 'This stock is not available to trade.');

  if (order.product === 'INTRADAY' && !intradayWindowOpen(ctx.now, ctx.holidays)) {
    return fail(
      'INTRADAY_MARKET_CLOSED',
      'Intraday orders can be placed only while the market is open, 9:15 AM to 3:20 PM IST. Choose Delivery to place an after-market order.',
    );
  }

  const price = order.price ?? ctx.ltp;
  if (price === null) {
    return fail(
      'NO_PRICE',
      `There is no market price for ${instrument.symbol} yet. Try again shortly.`,
    );
  }
  if (
    order.price !== null &&
    (order.price < instrument.lowerCircuit || order.price > instrument.upperCircuit)
  ) {
    return fail(
      'OUTSIDE_CIRCUIT',
      `Price ${formatInr(order.price)} is outside today's range for ${instrument.symbol}: ${formatInr(instrument.lowerCircuit)} to ${formatInr(instrument.upperCircuit)}.`,
    );
  }

  const value = order.qty * price;
  if (!Number.isSafeInteger(value)) {
    return fail('ORDER_TOO_LARGE', 'This order is too large. Reduce the quantity.');
  }

  if (order.side === 'SELL') {
    if (order.product === 'DELIVERY' && order.qty > ctx.sellableQty) {
      return fail(
        'INSUFFICIENT_HOLDINGS',
        ctx.sellableQty <= 0
          ? `You have no ${instrument.symbol} shares to sell for delivery.`
          : `You can sell up to ${String(ctx.sellableQty)} ${instrument.symbol} shares for delivery; this order is for ${String(order.qty)}.`,
      );
    }
    return { ok: true, blockAmount: 0 };
  }

  if (value > ctx.availableCash) {
    return fail(
      'INSUFFICIENT_FUNDS',
      `Not enough cash: this order needs ${formatInr(value)} and ${formatInr(Math.max(0, ctx.availableCash))} is available.`,
    );
  }
  return { ok: true, blockAmount: value };
}
