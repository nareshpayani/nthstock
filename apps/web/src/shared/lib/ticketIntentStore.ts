import type { Exchange, Order, OrderSide, ProductType } from '@nthstock/contracts';
import { create } from 'zustand';

/** What the order ticket should open with: the instrument and the side. */
export type TicketIntent = {
  symbol: string;
  exchange: Exchange;
  side: OrderSide;
  /**
   * An open (AMO or OPEN) order to modify (T-145): the ticket opens in modify mode with its terms,
   * and only quantity and price can change.
   */
  modify?: Order;
  /** Quantity to prefill, e.g. the open quantity when exiting a position (T-150). */
  qty?: number;
  /** Product to prefill, e.g. the position's own when exiting it (T-150). */
  product?: ProductType;
  /** A limit price to prefill, in paise: the ticket opens as a limit order at it (T17). */
  price?: number;
  /**
   * The compact ticket placed from the chart (T17, SPEC-TFC-1 §8.2): side, quantity, price,
   * product and "Add trailing stop", without the order-type switch or the depth panel.
   */
  compact?: boolean;
};

/**
 * The order-ticket intent (T-106). Buy and Sell buttons anywhere in the app (stock detail now,
 * watchlist rows in T-125) and Modify in the order book (T-145) dispatch `openTicket`; the order
 * ticket slide-over (T-135) opens from it and calls `closeTicket`. Shared by several features, so it lives in `shared/` (ADR 0005).
 * UI state only: nothing is sent to the server until the ticket places an order.
 */
export type TicketIntentState = {
  intent: TicketIntent | null;
  openTicket: (intent: TicketIntent) => void;
  closeTicket: () => void;
};

export const initialTicketIntentState = { intent: null };

export const useTicketIntentStore = create<TicketIntentState>()((set) => ({
  ...initialTicketIntentState,
  openTicket: (intent) => set({ intent: { ...intent } }),
  closeTicket: () => set({ intent: null }),
}));
