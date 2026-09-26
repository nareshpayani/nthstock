export const strings = {
  loadingChart: 'Loading chart',
  noData: 'No chart data for this range yet.',
  niftyTitle: 'NIFTY 50',
  rangeLabel: 'Chart range',
  live: 'Live',
  liveLabel: 'Live: the market is open and the price updates as it trades',
  niftyChartLabel: (range: string) => `NIFTY 50 area chart over ${range}`,
  chartSummary: (first: string, last: string, from: string, to: string) =>
    `From ${first} on ${from} to ${last} on ${to}.`,
  loadingLevel: 'Loading NIFTY 50 level',
  errorTitle: 'Chart unavailable',
  errorBody: 'The NIFTY 50 chart could not load.',
  retry: 'Retry',
  ranges: {
    '1D': '1 day',
    '1W': '1 week',
    '1M': '1 month',
    '1Y': '1 year',
    '5Y': '5 years',
  },
} as const;
