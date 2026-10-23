import type { Exchange, ProductType } from '@nthstock/contracts';
import { create } from 'zustand';

/** The position the trailing-stop sheet is about. */
export type TrailingSheetTarget = {
  symbol: string;
  exchange: Exchange;
  token: number;
  /** The position's product; the first open position in the instrument when left out. */
  product?: ProductType;
};

/**
 * Which position's trailing-stop sheet is open (T18, SPEC-TFC-1 §8.4). The chart's position chip
 * and trailing-stop line open it now, the phone position strip and the Scalper later (T23); the
 * sheet is mounted once in the app shell. UI state only: nothing is sent until Set, Update or
 * Cancel.
 */
export type TrailingSheetState = {
  target: TrailingSheetTarget | null;
  openSheet: (target: TrailingSheetTarget) => void;
  closeSheet: () => void;
};

export const initialTrailingSheetState = { target: null };

export const useTrailingSheetStore = create<TrailingSheetState>()((set) => ({
  ...initialTrailingSheetState,
  openSheet: (target) => set({ target: { ...target } }),
  closeSheet: () => set({ target: null }),
}));
