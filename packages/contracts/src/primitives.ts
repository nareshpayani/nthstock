import { z } from 'zod';

/** Minimum price step on NSE and BSE equities, in paise. */
export const TICK_SIZE_PAISE = 5;

/** Money as an integer number of paise (₹1 = 100 paise). Never a float. May be negative (P&L). */
export const Paise = z.number().int();
export type Paise = z.infer<typeof Paise>;

/** A non-negative amount of paise (balances, values, prices). */
export const NonNegativePaise = Paise.min(0);
export type NonNegativePaise = z.infer<typeof NonNegativePaise>;

/** A tradable price: positive paise on the 5-paise tick. */
export const TickPrice = Paise.positive().multipleOf(TICK_SIZE_PAISE, {
  error: `Price must be a multiple of ${TICK_SIZE_PAISE} paise`,
});
export type TickPrice = z.infer<typeof TickPrice>;

/** A percentage in basis points (1% = 100 bp), as an integer. */
export const BasisPoints = z.number().int();
export type BasisPoints = z.infer<typeof BasisPoints>;

/** A whole-number count (quantity, volume, orders) that can be zero. */
export const Count = z.number().int().min(0);
export type Count = z.infer<typeof Count>;

/** Exchange trading symbol: uppercase A–Z, 0–9, `&` and `-`, 1–20 chars (e.g. `INFY`, `M&M`, `BAJAJ-AUTO`). */
export const TradingSymbol = z
  .string()
  .regex(/^[A-Z0-9&-]{1,20}$/, { error: 'Symbol must be 1–20 uppercase letters, digits, & or -' });
export type TradingSymbol = z.infer<typeof TradingSymbol>;

export const Exchange = z.enum(['NSE', 'BSE']);
export type Exchange = z.infer<typeof Exchange>;

/** An ISO 8601 UTC timestamp ending in `Z`, e.g. `2026-09-25T03:45:00.000Z`. Display converts to IST. */
export const IsoUtc = z.iso.datetime({ offset: false, local: false });
export type IsoUtc = z.infer<typeof IsoUtc>;

/** Numeric instrument token, unique across exchanges. Used as the compact key on the wire. */
export const InstrumentToken = z.number().int().positive();
export type InstrumentToken = z.infer<typeof InstrumentToken>;

/** An opaque server-issued identifier (watchlists, orders, ledger entries, users, devices). */
export const Id = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, { error: 'Invalid id' });
export type Id = z.infer<typeof Id>;

/** Error codes the API and WS server can return. User-facing copy lives in each feature's strings.ts. */
export const ApiErrorCode = z.enum([
  'VALIDATION_ERROR',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'LIMIT_REACHED',
  'RATE_LIMITED',
  'CAPTCHA_REQUIRED',
  'OTP_INVALID',
  'OTP_EXPIRED',
  'PIN_INVALID',
  'PIN_LOCKED',
  'MARKET_CLOSED',
  'INSUFFICIENT_FUNDS',
  'INSUFFICIENT_HOLDINGS',
  'ORDER_REJECTED',
  'INVALID_ORDER_STATE',
  'SERVICE_UNAVAILABLE',
  'INTERNAL_ERROR',
]);
export type ApiErrorCode = z.infer<typeof ApiErrorCode>;

/** The error envelope every non-2xx `/v1` response returns. */
export const ApiError = z.object({
  error: z.object({
    code: ApiErrorCode,
    message: z.string().min(1),
    details: z.record(z.string(), z.unknown()).optional(),
  }),
});
export type ApiError = z.infer<typeof ApiError>;

/** Opaque pagination cursor. */
export const Cursor = z.string().min(1).max(512);
export type Cursor = z.infer<typeof Cursor>;

export const PAGE_LIMIT_DEFAULT = 50;
export const PAGE_LIMIT_MAX = 100;

/** Query string for a cursor-paginated list. Values arrive as strings, so `limit` is coerced. */
export const CursorQuery = z.object({
  cursor: Cursor.optional(),
  limit: z.coerce.number().int().min(1).max(PAGE_LIMIT_MAX).optional(),
});
export type CursorQuery = z.infer<typeof CursorQuery>;

/** Builds a cursor page schema: `{ items, nextCursor }`, where `nextCursor` is null on the last page. */
export const cursorPage = <T extends z.ZodType>(item: T) =>
  z.object({
    items: z.array(item),
    nextCursor: Cursor.nullable(),
  });
export type CursorPage<T> = { items: T[]; nextCursor: Cursor | null };

/** Generic success body for commands with nothing else to return. */
export const OkResponse = z.object({ ok: z.literal(true) });
export type OkResponse = z.infer<typeof OkResponse>;
