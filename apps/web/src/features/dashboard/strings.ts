export const strings = {
  pageTitle: 'Dashboard',
  greeting: {
    morning: 'Good morning',
    afternoon: 'Good afternoon',
    evening: 'Good evening',
    withName: (greeting: string, name: string) => `${greeting}, ${name}`,
  },
  heroBody:
    'Practise investing on NSE and BSE stocks with ₹10,00,000 of virtual cash. No real money.',
  heroCta: 'View funds',
  heroCtaSignedOut: 'Start paper trading',
  paperTag: 'Paper trading',
  /** The first chart: a stock to trade on, or NIFTY 50 (NSTOCK-0476). */
  homeChart: {
    pickerLabel: 'Chart',
    symbols: { HDFCBANK: 'HDFC', PAYTM: 'Paytm', RELIANCE: 'Reliance', NIFTY50: 'NIFTY 50' },
    symbolNames: {
      HDFCBANK: 'HDFC Bank',
      PAYTM: 'Paytm',
      RELIANCE: 'Reliance',
      NIFTY50: 'NIFTY 50',
    },
    sectionLabel: (symbol: string) => `Trade ${symbol} from the chart`,
    hint: 'Drag a line to set a price',
    tradeLabel: (symbol: string) => `Trade ${symbol}`,
    buy: (symbol: string) => `Buy ${symbol}`,
    sell: (symbol: string) => `Sell ${symbol}`,
    loading: (symbol: string) => `Loading the ${symbol} chart`,
    errorTitle: (symbol: string) => `${symbol} could not load`,
    errorBody: 'The rest of Home still works. Try the chart again.',
  },
  /** Names of the sections, for the error shown when one of them crashes. */
  sections: {
    chart: 'Home chart',
    indices: 'Market indices',
    lists: 'Stocks lists',
    movers: 'Market movers',
  },
  /** Home on a phone (NSTOCK-0466). */
  phone: {
    valueLabel: 'Portfolio value',
    signedOutLabel: 'Virtual cash',
    valueLoading: 'Loading your portfolio value',
    stale: 'Not refreshed: the last value shown.',
    feedSection: 'Your stocks and market movers',
    today: 'today',
    signedOutNote: 'Virtual cash to practise with',
    valueError: 'Your portfolio value could not load',
    logIn: 'Log in',
    addFunds: 'Add funds',
    placeOrder: 'Place order',
    feedLabel: 'Stocks',
    feeds: { watchlist: 'Watchlist', gainers: 'Gainers', losers: 'Losers' },
  },
  sectionError: {
    title: 'This section could not load',
    body: 'The rest of the dashboard still works. Try this section again.',
    retry: 'Try again',
  },
} as const;
