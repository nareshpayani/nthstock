import { create } from 'zustand';

/**
 * Asks the app shell to open stock search (T-153): the empty states of orders, positions and
 * holdings have a "Search stocks" button, and the shell owns the search box (in the left rail, or
 * in the drawer below 1024 px, next to the watchlist). Each request bumps `requests`; the shell
 * focuses search when it changes. UI state only (ADR 0005).
 */
export type SearchFocusState = {
  requests: number;
  /** "Add stock" on a watchlist: search that adds to the open list (a sheet of its own on a phone). */
  addRequests: number;
  requestSearch: () => void;
  requestAddToWatchlist: () => void;
};

export const initialSearchFocusState = { requests: 0, addRequests: 0 };

export const useSearchFocusStore = create<SearchFocusState>()((set) => ({
  ...initialSearchFocusState,
  requestSearch: () => set((state) => ({ requests: state.requests + 1 })),
  requestAddToWatchlist: () => set((state) => ({ addRequests: state.addRequests + 1 })),
}));
