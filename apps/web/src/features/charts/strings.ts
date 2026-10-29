export const strings = {
  loadingChart: 'Loading chart',
  noData: 'No chart data for this range yet.',
  niftyTitle: 'NIFTY 50',
  /** Zoom buttons on the dashboard chart (NSTOCK-0437). */
  zoom: {
    label: 'Chart zoom',
    in: 'Zoom in',
    out: 'Zoom out',
    reset: 'Reset zoom',
  },
  rangeLabel: 'Chart range',
  /** Bar size picker (NSTOCK-0343, NSTOCK-0443). */
  intervalLabel: 'Bar size',
  intervalOption: (bars: string) => `${bars} bars`,
  /** Chart type menu (NSTOCK-0430), shared by the dashboard and the instrument page. */
  typeButton: (type: string) => `Chart type: ${type}`,
  types: { line: 'Line', area: 'Area', candle: 'Candles', bar: 'OHLC', heikin: 'Heikin-Ashi' },
  /** Each type's description line in the menu. */
  typeHints: {
    line: 'Closing prices joined by a line',
    area: 'Closing prices with the area below shaded',
    candle: 'Open, high, low and close; rising bars green, falling bars red',
    bar: 'Open tick left, close tick right, high to low',
    heikin:
      'Smoothed candles that show the trend. Not traded prices; the tooltip shows the real ones',
  },
  /** Each type as it reads inside a chart's accessible name. */
  typeNames: {
    line: 'line',
    area: 'area',
    candle: 'candlestick',
    bar: 'OHLC bar',
    heikin: 'Heikin-Ashi (smoothed)',
  },
  live: 'Live',
  liveLabel: 'Live: the market is open and the price updates as it trades',
  /** `bars` only when the reader picked a bar size other than the range's own. */
  niftyChartLabel: (type: string, range: string, bars?: string) =>
    `NIFTY 50 ${type} chart over ${range}${bars ? `, ${bars} bars` : ''}`,
  chartSummary: (first: string, last: string, from: string, to: string) =>
    `From ${first} on ${from} to ${last} on ${to}.`,
  loadingLevel: 'Loading NIFTY 50 level',
  errorTitle: 'Chart unavailable',
  errorBody: 'The NIFTY 50 chart could not load.',
  retry: 'Retry',
  tooltip: {
    price: 'Price',
    level: 'Level',
    open: 'Open',
    high: 'High',
    low: 'Low',
    close: 'Close',
  },
  /** Bar sizes spelled out for accessible names (NSTOCK-0343). */
  intervals: {
    '1m': '1-minute',
    '5m': '5-minute',
    '15m': '15-minute',
    '30m': '30-minute',
    '1h': '1-hour',
    '1d': 'daily',
    '1w': 'weekly',
  },
  ranges: {
    '1D': '1 day',
    '1W': '1 week',
    '1M': '1 month',
    '1Y': '1 year',
    '5Y': '5 years',
  },
} as const;
