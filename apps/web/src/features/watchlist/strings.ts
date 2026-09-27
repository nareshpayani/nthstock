import { WATCHLIST_MAX_LISTS, WATCHLIST_MESSAGES, WATCHLIST_NAME_MAX } from '@nthstock/contracts';

const plural = (n: number, one: string, many: string) => `${String(n)} ${n === 1 ? one : many}`;

export const strings = {
  title: 'Watchlists',
  count: (n: number) => plural(n, 'stock', 'stocks'),
  tabsLabel: 'Your watchlists',
  rowsLabel: (list: string) => `Stocks in ${list}`,
  loading: 'Loading your watchlists',
  loadError: {
    title: "Couldn't load your watchlists",
    body: 'Check your connection and try again.',
    retry: 'Retry',
  },
  signedOut: {
    title: 'Track stocks in watchlists',
    body: 'Log in to create watchlists and follow their prices live.',
    login: 'Log in',
    /** Starts with the visible words (WCAG 2.5.3) and tells it apart from the header's Log in. */
    loginLabel: 'Log in to use watchlists',
  },
  emptyTitle: 'This watchlist is empty',
  emptyBody: 'Add stocks to track their prices here. Search above or press / to start.',
  addStock: 'Add stock',
  /** List actions (T-120). */
  lists: {
    create: 'New watchlist',
    createDisabled: `You can have up to ${String(WATCHLIST_MAX_LISTS)} watchlists`,
    actions: (name: string) => `Actions for ${name}`,
    rename: 'Rename',
    delete: 'Delete',
    deleteDisabled: 'You need at least one watchlist',
  },
  dialogs: {
    createTitle: 'New watchlist',
    renameTitle: 'Rename watchlist',
    nameLabel: 'Name',
    nameHint: `Up to ${String(WATCHLIST_NAME_MAX)} characters`,
    nameTaken: WATCHLIST_MESSAGES.duplicateName,
    create: 'Create',
    save: 'Save',
    cancel: 'Cancel',
    deleteTitle: (name: string) => `Delete “${name}”?`,
    deleteBody: (count: number) =>
      count === 0
        ? 'This watchlist is empty. This cannot be undone.'
        : `Its ${plural(count, 'stock', 'stocks')} will be removed with it. This cannot be undone.`,
    deleteConfirm: 'Delete watchlist',
  },
  /** Row actions and keys (T-121, T-122, T-125). */
  row: {
    buy: 'B',
    sell: 'S',
    buyLabel: (symbol: string) => `Buy ${symbol}`,
    sellLabel: (symbol: string) => `Sell ${symbol}`,
    removeLabel: (symbol: string) => `Remove ${symbol}`,
    dragLabel: (symbol: string) => `Drag to reorder ${symbol}`,
    keyHint: 'On a stock: B buy, S sell, Alt+↑/↓ move, Delete remove.',
    ticketSoon: {
      title: (side: string, symbol: string) => `${side} ${symbol}`,
      body: 'The order ticket arrives in a later release. Paper trading only.',
    },
    buyWord: 'Buy',
    sellWord: 'Sell',
  },
  /** Live-region announcements. */
  announce: {
    moved: (name: string, position: number, total: number) =>
      `${name} moved to position ${String(position)} of ${String(total)}`,
    atEdge: (name: string) => `${name} cannot move further`,
    sortedOnly: 'Choose Custom order in Sort to reorder stocks',
    added: (symbol: string, list: string) => `${symbol} added to ${list}`,
    alreadyIn: (symbol: string, list: string) => `${symbol} is already in ${list}`,
    removed: (symbol: string, list: string) => `${symbol} removed from ${list}`,
    created: (name: string) => `Watchlist ${name} created`,
    renamed: (name: string) => `Watchlist renamed to ${name}`,
    deleted: (name: string) => `Watchlist ${name} deleted`,
    sorted: (label: string) => `Sorted by ${label}`,
  },
  /** Sort menu (T-123). */
  sortLabel: 'Sort watchlist',
  sortBy: 'Sort by',
  sort: {
    custom: 'Custom order',
    name: 'Name (A to Z)',
    ltp: 'Last price (high to low)',
    change: '% change (high to low)',
  },
  /** Star on the stock detail page (T-121). */
  star: {
    add: (symbol: string) => `Add ${symbol} to a watchlist`,
    edit: (symbol: string) => `${symbol} is in your watchlist. Change watchlists`,
    menuLabel: 'Watchlists',
  },
  /** Add from search (T-121). */
  search: {
    add: (list: string) => `Add to ${list}`,
    added: (list: string) => `In ${list}`,
    hint: (list: string) => `Shift+Enter adds to ${list}`,
  },
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
