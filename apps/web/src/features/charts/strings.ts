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
  /** The legend above the plot (NSTOCK-0460): TradingView-style one-letter labels. */
  legend: { open: 'O', high: 'H', low: 'L', close: 'C', volume: 'Vol' },
  /** Indicators menu (NSTOCK-0460). */
  studies: {
    button: 'Indicators',
    // Starts with the visible text ("Indicators 2"), so voice control can name it (WCAG 2.5.3).
    buttonLabel: (count: number) =>
      count === 0 ? 'Indicators, none on' : `Indicators ${String(count)} on`,
    heading: 'Show on the chart',
    noVolume: 'An index trades no shares, so it has no volume',
    names: {
      volume: 'Volume',
      sma20: 'Moving average 20',
      sma50: 'Moving average 50',
      ema20: 'Exponential average 20',
      vwap: 'VWAP',
      bollinger: 'Bollinger bands 20, 2',
    },
    hints: {
      volume: 'Shares traded in each bar, under the price',
      sma20: 'Average close of the last 20 bars; solid dark line',
      sma50: 'Average close of the last 50 bars; dashed grey line',
      ema20: 'Like the 20 average, but recent bars count more; dashed dark line',
      vwap: 'Average price weighted by volume since the open; dotted dark line',
      bollinger: 'A band two deviations around the 20 average; dotted grey lines',
    },
  },
  /** The tool rail and drawings (NSTOCK-0461). */
  drawing: {
    rail: 'Drawing tools',
    cursor: 'Crosshair: pan and zoom the chart',
    tools: {
      trend: 'Trend line',
      horizontal: 'Horizontal line',
      ray: 'Ray',
      fib: 'Fibonacci retracement',
      text: 'Text note',
      measure: 'Measure',
      zoom: 'Zoom to an area',
    },
    hints: {
      trend: 'Tap the start, then the end, or drag between them',
      horizontal: 'Tap a price to draw a line across',
      ray: 'Tap the start, then a point it runs through',
      fib: 'Tap the start of the move, then its end',
      text: 'Tap where the note goes, then type it',
      measure: 'Tap two points to measure between them',
      zoom: 'Drag across the bars to zoom in on them',
    },
    magnet: 'Magnet: snap to open, high, low or close',
    undo: 'Undo last drawing',
    clear: 'Clear all drawings',
    clearMeasure: 'Clear measure',
    notSaved: "Drawings can't be saved on this device, so they last until you leave the page",
    noteLabel: 'Note text',
    bars: 'bars',
    draw: 'Draw',
    /** Placing points from the keyboard (NSTOCK-0468). */
    keyboard: {
      plot: 'Chart plot',
      noTool: 'Pick a drawing tool, then come back here to place it with the keyboard',
      howTo:
        'Arrow keys move the point by a bar or a price step, Shift moves faster, Home and End go to the first and last bar. Enter places the point, Escape drops the tool.',
      at: (time: string, price: string) => `${time}, ${price}`,
      startPlaced: (time: string, price: string) =>
        `Start placed at ${time}, ${price}. Move to the end and press Enter`,
      placed: (tool: string) => `${tool} placed`,
    },
    list: {
      button: (count: number) => `Drawings on this chart (${String(count)})`,
      empty: 'No drawings yet',
      remove: (name: string) => `Remove ${name}`,
      line: (tool: string, prices: string) => `${tool}, ${prices}`,
      note: (text: string, price: string) => `note "${text}" at ${price}`,
      removed: (name: string) => `Removed ${name}`,
    },
  },
  /** The full-screen chart (NSTOCK-0461). */
  fullscreen: {
    open: 'Open the chart full screen',
    draw: 'Draw: open the chart full screen with the drawing tools',
    close: 'Close full screen',
    title: (name: string) => `${name} chart`,
  },
  /** Chart image and the clock (NSTOCK-0463). */
  snapshot: {
    save: 'Save the chart as an image',
    share: 'Share the chart as an image',
    saved: 'Chart image saved',
    shared: 'Chart image shared',
    failed: 'Could not make the chart image. Try again.',
    brand: 'nthstock',
  },
  clock: { suffix: 'IST', label: (time: string) => `Time ${time} IST` },
  /** Each indicator line's short name in the legend. */
  studyShort: {
    sma20: 'SMA 20',
    sma50: 'SMA 50',
    ema20: 'EMA 20',
    vwap: 'VWAP',
    'bollinger-upper': 'BB U',
    'bollinger-middle': 'BB 20',
    'bollinger-lower': 'BB L',
  } as Record<string, string>,
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
