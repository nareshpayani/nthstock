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
} as const;
