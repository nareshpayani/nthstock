import type { Exchange, ProductType } from '@nthstock/contracts';
import { create } from 'zustand';

/** The editor's sections: the trailing stop, an exit (full or partial), or adding to the position. */
export type PositionEditorTab = 'stop' | 'exit' | 'add';

/** The position the editor is about: one instrument in one product. */
export type PositionEditorTarget = {
  symbol: string;
  exchange: Exchange;
  token: number;
  product: ProductType;
  /** The section it opens on; the trailing stop when left out. */
  tab?: PositionEditorTab;
};

/**
 * Which position's editor is open (NSTOCK-0395): Edit on a Positions row and "Edit stop" on an
 * order with a trailing stop open it, and it is mounted once in the app shell. UI state only:
 * nothing is sent until a button inside the editor is tapped.
 */
export type PositionEditorState = {
  target: PositionEditorTarget | null;
  openEditor: (target: PositionEditorTarget) => void;
  closeEditor: () => void;
};

export const initialPositionEditorState = { target: null };

export const usePositionEditorStore = create<PositionEditorState>()((set) => ({
  ...initialPositionEditorState,
  openEditor: (target) => set({ target: { ...target } }),
  closeEditor: () => set({ target: null }),
}));
