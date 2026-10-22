import { create } from 'zustand';

/** An order line being dragged on the chart: the order and the price under the finger (paise). */
export type OrderDraft = { orderId: string; price: number };

/**
 * The live drag of an order line (T16, SPEC-TFC-1 §9.3, TFC-21). While the finger moves, every
 * surface that shows the order (the chart, the order book, the phone Orders tab and the depth
 * card) shows this price; nothing is sent until release, when the chart sends one modify and the
 * trading store holds it as a pending intent. UI state only, so it lives in `shared/` (ADR 0005).
 */
export type OrderDraftState = {
  draft: OrderDraft | null;
  setDraft: (draft: OrderDraft | null) => void;
};

export const initialOrderDraftState = { draft: null };

export const useOrderDraftStore = create<OrderDraftState>()((set) => ({
  ...initialOrderDraftState,
  setDraft: (draft) => set({ draft }),
}));
