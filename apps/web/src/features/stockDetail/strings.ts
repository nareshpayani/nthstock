export const strings = {
  /** Browser tab title: "Infosys Ltd (INFY)". */
  pageTitle: (name: string, symbol: string) => `${name} (${symbol})`,
  notFound: {
    pageTitle: 'Stock not found',
    title: 'Stock not found',
    body: (symbol: string) =>
      `We could not find ${symbol} on NSE or BSE. Check the symbol, or search for the company by name.`,
    back: 'Go to dashboard',
  },
  instrumentType: { EQUITY: 'Equity', INDEX: 'Index' },
  sectionError: {
    title: 'This section could not load',
    body: 'Something went wrong here. The rest of the page still works.',
    retry: 'Try again',
  },
  chart: {
    title: 'Price chart',
    rangeLabel: 'Chart range',
    typeLabel: 'Chart type',
    types: { area: 'Area', candle: 'Candles' },
    label: (symbol: string, type: string, range: string) => `${symbol} ${type} chart over ${range}`,
    typeNames: { area: 'area', candle: 'candlestick' },
    loading: 'Loading chart',
    errorTitle: 'Chart unavailable',
    errorBody: 'The price chart could not load.',
    retry: 'Retry',
  },
  header: {
    exchangeLabel: 'Exchange',
    notListed: (symbol: string, exchange: string) => `${symbol} is not listed on ${exchange}.`,
    priceLabel: 'Last traded price',
    changeLabel: 'Day change',
    tradeLabel: (symbol: string) => `Trade ${symbol}`,
    buy: 'Buy',
    sell: 'Sell',
    buyLabel: (symbol: string) => `Buy ${symbol}`,
    sellLabel: (symbol: string) => `Sell ${symbol}`,
    paperNote: 'Paper trading: virtual cash only.',
    ticketSoon: {
      title: (side: string, symbol: string) => `${side} ${symbol}`,
      body: 'The paper order ticket opens here in an upcoming release.',
    },
  },
} as const;
