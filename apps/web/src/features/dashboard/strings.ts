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
  /** Names of the sections, for the error shown when one of them crashes. */
  sections: {
    chart: 'NIFTY 50 chart',
    indices: 'Market indices',
    lists: 'Stocks lists',
    movers: 'Market movers',
  },
  sectionError: {
    title: 'This section could not load',
    body: 'The rest of the dashboard still works. Try this section again.',
    retry: 'Try again',
  },
} as const;
