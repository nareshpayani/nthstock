import { create } from 'zustand';

/**
 * Zustand conventions (ADR 0005), shown on the app shell's own UI state:
 * - one small store per feature (or app area), UI-only state; server data stays in TanStack Query
 *   and URL state (tabs, filters, ranges) in search params;
 * - actions live in the store; components select the slice they need:
 *   `useShellStore((s) => s.drawerOpen)`;
 * - export `initial…State` so tests can reset with `useShellStore.setState(initialShellState)`.
 */
export type ShellState = {
  drawerOpen: boolean;
  helpOpen: boolean;
  setDrawerOpen: (open: boolean) => void;
  setHelpOpen: (open: boolean) => void;
};

export const initialShellState = { drawerOpen: false, helpOpen: false };

export const useShellStore = create<ShellState>()((set) => ({
  ...initialShellState,
  setDrawerOpen: (drawerOpen) => set({ drawerOpen }),
  setHelpOpen: (helpOpen) => set({ helpOpen }),
}));
