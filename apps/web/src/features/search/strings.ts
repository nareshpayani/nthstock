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
  resultCount: (count: number) => (count === 1 ? '1 result' : `${String(count)} results`),
} as const;
