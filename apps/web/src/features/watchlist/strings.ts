import { WATCHLIST_MESSAGES } from '@nthstock/contracts';

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
  /** Toasts for failed changes (T-118); the rule copy matches what both backends answer. */
  errors: {
    title: {
      create: () => "Couldn't create the watchlist",
      rename: () => "Couldn't rename the watchlist",
      delete: () => "Couldn't delete the watchlist",
      reorder: () => "Couldn't save the new order",
      add: (symbol: string) => `Couldn't add ${symbol || 'the stock'}`,
      remove: (symbol: string) => `Couldn't remove ${symbol || 'the stock'}`,
    },
    listLimit: WATCHLIST_MESSAGES.listLimit,
    itemLimit: WATCHLIST_MESSAGES.itemLimit,
    duplicateName: WATCHLIST_MESSAGES.duplicateName,
    duplicateItem: (symbol: string) =>
      symbol ? WATCHLIST_MESSAGES.duplicateItem(symbol) : 'This stock is already in the watchlist.',
    lastList: WATCHLIST_MESSAGES.lastList,
    staleOrder: WATCHLIST_MESSAGES.staleOrder,
    listGone: WATCHLIST_MESSAGES.notFound,
    stockOrListGone: 'This stock or watchlist could not be found. Refresh and try again.',
    invalid: 'That change is not valid. Check it and try again.',
    loggedOut: 'Log in again to change your watchlists.',
    network: 'Check your internet connection and try again.',
    generic: 'Something went wrong. Please try again.',
  },
} as const;
