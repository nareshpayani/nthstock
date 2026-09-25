import { z } from 'zod';
import {
  BasisPoints,
  Count,
  Exchange,
  Id,
  InstrumentToken,
  IsoUtc,
  NonNegativePaise,
  Paise,
  TradingSymbol,
  cursorPage,
} from './primitives.js';
import { ProductType } from './orders.js';

/** Paper trading opening balance: ₹10,00,000 in paise. */
export const PAPER_OPENING_BALANCE_PAISE = 10_00_000_00;

/** Today's position for one instrument and product. `netQty` is negative for an intraday short. */
export const Position = z.object({
  token: InstrumentToken,
  symbol: TradingSymbol,
  exchange: Exchange,
  product: ProductType,
  netQty: z.number().int(),
  buyQty: Count,
  sellQty: Count,
  avgBuyPrice: NonNegativePaise,
  avgSellPrice: NonNegativePaise,
  ltp: NonNegativePaise,
  realisedPnl: Paise,
  unrealisedPnl: Paise,
});
export type Position = z.infer<typeof Position>;

export const PositionsResponse = z.object({ items: z.array(Position) });
export type PositionsResponse = z.infer<typeof PositionsResponse>;

/** A delivery holding carried across days. */
export const Holding = z.object({
  token: InstrumentToken,
  symbol: TradingSymbol,
  exchange: Exchange,
  qty: z.number().int().min(1),
  avgPrice: NonNegativePaise,
  ltp: NonNegativePaise,
  investedValue: NonNegativePaise,
  currentValue: NonNegativePaise,
  pnl: Paise,
  pnlBp: BasisPoints,
  dayChange: Paise,
  dayChangeBp: BasisPoints,
});
export type Holding = z.infer<typeof Holding>;

export const HoldingsResponse = z.object({ items: z.array(Holding) });
export type HoldingsResponse = z.infer<typeof HoldingsResponse>;

export const PortfolioSummary = z.object({
  investedValue: NonNegativePaise,
  currentValue: NonNegativePaise,
  totalPnl: Paise,
  totalPnlBp: BasisPoints,
  dayPnl: Paise,
  dayPnlBp: BasisPoints,
  holdingsCount: Count,
  positionsCount: Count,
  asOf: IsoUtc,
});
export type PortfolioSummary = z.infer<typeof PortfolioSummary>;

/** Paper funds. `available` = `balance` − `blocked`. */
export const FundsSummary = z
  .object({
    openingBalance: NonNegativePaise,
    balance: Paise,
    blocked: NonNegativePaise,
    available: Paise,
    realisedPnlToday: Paise,
    asOf: IsoUtc,
  })
  .refine((f) => f.available === f.balance - f.blocked, {
    error: 'available must equal balance minus blocked',
    path: ['available'],
  });
export type FundsSummary = z.infer<typeof FundsSummary>;

export const LedgerEntryType = z.enum([
  'OPENING_CREDIT',
  'ORDER_BLOCK',
  'ORDER_RELEASE',
  'TRADE_DEBIT',
  'TRADE_CREDIT',
  'RESET',
]);
export type LedgerEntryType = z.infer<typeof LedgerEntryType>;

/** Append-only funds ledger entry. `amount` is signed; `balanceAfter` is available cash after it. */
export const LedgerEntry = z.object({
  id: Id,
  type: LedgerEntryType,
  amount: Paise,
  balanceAfter: Paise,
  orderId: Id.nullable(),
  description: z.string().min(1).max(200),
  createdAt: IsoUtc,
});
export type LedgerEntry = z.infer<typeof LedgerEntry>;

export const LedgerPage = cursorPage(LedgerEntry);
export type LedgerPage = z.infer<typeof LedgerPage>;

/** Reset paper balance. The user must type RESET to confirm. */
export const ResetRequest = z.object({
  confirm: z.literal('RESET', { error: 'Type RESET to confirm' }),
});
export type ResetRequest = z.infer<typeof ResetRequest>;
