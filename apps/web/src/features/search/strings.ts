export const strings = {
  label: 'Search stocks',
  placeholder: 'Search eg: INFY, Nifty',
  shortcutHint: 'Press / to search',
  listLabel: 'Stock suggestions',
  recentTitle: 'Recent searches',
  popularTitle: 'Popular searches',
  searching: 'Searching…',
  error: 'Search is unavailable right now. Try again in a moment.',
  noResults: (query: string) => `No stocks match “${query}”`,
  /** Adding a result to the open watchlist (T-121). */
  addTo: (list: string) => `Add to ${list}`,
  inList: (list: string) => `In ${list}`,
  addHint: (list: string) => `Shift+Enter adds the highlighted stock to ${list}`,
  tapToAdd: (list: string) => `Tap a stock to add it to ${list}`,
  added: (symbol: string, list: string) => `${symbol} added to ${list}`,
  alreadyIn: (symbol: string, list: string) => `${symbol} is already in ${list}`,
  resultCount: (count: number) => (count === 1 ? '1 result' : `${String(count)} results`),
} as const;
