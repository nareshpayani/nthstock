export const strings = {
  title: 'My Watchlist',
  count: (n: number) => `${String(n)} ${n === 1 ? 'stock' : 'stocks'}`,
  emptyTitle: 'Your watchlist is empty',
  emptyBody: 'Add stocks to track their prices here. Search above or press / to start.',
  addStock: 'Add stock',
  sortLabel: 'Sort watchlist',
  sortBy: 'Sort by',
  sortName: 'Name (A to Z)',
  sortChange: 'Change %',
  sortPrice: 'Last price',
} as const;
