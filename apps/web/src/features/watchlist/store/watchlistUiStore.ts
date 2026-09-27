import { create } from 'zustand';
import { safeStorage } from '@/shared/lib/safeStorage';
import { isWatchlistSort, type WatchlistSort } from '../model/sortItems';

export const ACTIVE_LIST_KEY = 'nth.watchlist.active';
export const ACTIVE_NAME_KEY = 'nth.watchlist.activeName';
export const SORT_KEY = 'nth.watchlist.sort';

/**
 * Watchlist UI state shared by distant parts of the left rail (ADR 0005): the list tab that is
 * open, the sort (the menu sits next to search, the rows further down) and the latest screen-reader
 * announcement. The rail lives in the shell on every route, so this is not URL state; the tab and
 * the sort are remembered per browser in localStorage (a convenience: storage may be missing).
 */
export type WatchlistUiState = {
  activeListId: string | null;
  /**
   * The open list's name, the fallback when the id is unknown: a list created a moment ago has a
   * temporary id until the server answers (names are unique).
   */
  activeListName: string | null;
  sort: WatchlistSort;
  /** The latest live-region message; `seq` changes even when the text repeats. */
  announcement: { text: string; seq: number };
  setActiveList: (list: { id: string | null; name: string | null }) => void;
  setSort: (sort: WatchlistSort) => void;
  announce: (text: string) => void;
};

const savedSort = (): WatchlistSort => {
  const saved = safeStorage.get(SORT_KEY);
  return isWatchlistSort(saved) ? saved : 'custom';
};

export const initialWatchlistUiState = () => ({
  activeListId: safeStorage.get(ACTIVE_LIST_KEY),
  activeListName: safeStorage.get(ACTIVE_NAME_KEY),
  sort: savedSort(),
  announcement: { text: '', seq: 0 },
});

export const useWatchlistUiStore = create<WatchlistUiState>()((set) => ({
  ...initialWatchlistUiState(),
  setActiveList: ({ id, name }) => {
    const remember = (key: string, value: string | null) => {
      if (value) safeStorage.set(key, value);
      else safeStorage.remove(key);
    };
    remember(ACTIVE_LIST_KEY, id);
    remember(ACTIVE_NAME_KEY, name);
    set({ activeListId: id, activeListName: name });
  },
  setSort: (sort) => {
    safeStorage.set(SORT_KEY, sort);
    set({ sort });
  },
  announce: (text) => set((state) => ({ announcement: { text, seq: state.announcement.seq + 1 } })),
}));
