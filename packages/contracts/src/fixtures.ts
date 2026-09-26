/**
 * Valid sample payloads for every contract, used by the round-trip tests.
 * Kept out of the published build (see tsconfig.build.json).
 */
import type {
  Device,
  OtpRequestResponse,
  OtpVerifyRequest,
  PinSetRequest,
  Session,
  User,
} from './auth.js';
import type {
  CandleSeries,
  Depth,
  IndexSummary,
  Instrument,
  InstrumentStats,
  Movers,
  Quote,
  QuoteRow,
  SearchResponse,
  StockList,
} from './market.js';
import type { ModifyOrderRequest, Order, PlaceOrderRequest } from './orders.js';
import type {
  FundsSummary,
  Holding,
  LedgerEntry,
  PortfolioSummary,
  Position,
  ResetRequest,
} from './portfolio.js';
import type { ApiError } from './primitives.js';
import type { Watchlist, WatchlistItem } from './watchlist.js';
import type { WsClientMessage, WsServerMessage } from './ws.js';

const TS = '2026-09-25T04:00:00.000Z';

export const apiErrorFixture: ApiError = {
  error: { code: 'VALIDATION_ERROR', message: 'Invalid body', details: { field: 'qty' } },
};

export const instrumentFixture: Instrument = {
  token: 408065,
  symbol: 'INFY',
  exchange: 'NSE',
  name: 'Infosys Ltd',
  type: 'EQUITY',
  isin: 'INE009A01021',
  sector: 'Information Technology',
  lotSize: 1,
  tickSize: 5,
};

export const indexInstrumentFixture: Instrument = {
  token: 256265,
  symbol: 'NIFTY50',
  exchange: 'NSE',
  name: 'Nifty 50',
  type: 'INDEX',
  isin: null,
  sector: null,
  lotSize: 1,
  tickSize: 5,
};

export const searchResponseFixture: SearchResponse = {
  items: [{ token: 408065, symbol: 'INFY', exchange: 'NSE', name: 'Infosys Ltd', type: 'EQUITY' }],
};

export const quoteFixture: Quote = {
  token: 408065,
  symbol: 'INFY',
  exchange: 'NSE',
  ltp: 152_345,
  change: -1_255,
  changeBp: -82,
  open: 153_600,
  high: 154_000,
  low: 152_000,
  prevClose: 153_600,
  volume: 4_210_332,
  ts: TS,
};

export const statsFixture: InstrumentStats = {
  token: 408065,
  symbol: 'INFY',
  exchange: 'NSE',
  open: 153_600,
  high: 154_000,
  low: 152_000,
  prevClose: 153_600,
  volume: 4_210_332,
  week52High: 200_600,
  week52Low: 135_805,
  upperCircuit: 184_320,
  lowerCircuit: 122_880,
  marketCap: 632_512_000_000_000,
  peX100: 2_453,
  dividendYieldBp: 285,
  asOf: TS,
};

export const candleSeriesFixture: CandleSeries = {
  symbol: 'INFY',
  exchange: 'NSE',
  range: '1D',
  interval: '5m',
  candles: [
    { t: '2026-09-25T03:45:00.000Z', o: 153_600, h: 153_900, l: 153_400, c: 153_750, v: 12_000 },
    { t: '2026-09-25T03:50:00.000Z', o: 153_750, h: 153_800, l: 153_200, c: 153_300, v: 9_800 },
  ],
};

const level = (price: number, qty: number) => ({ price, qty, orders: 3 });

export const depthFixture: Depth = {
  token: 408065,
  symbol: 'INFY',
  exchange: 'NSE',
  bids: [
    level(152_340, 120),
    level(152_335, 80),
    level(152_330, 40),
    level(152_325, 20),
    level(152_320, 10),
  ],
  asks: [
    level(152_345, 100),
    level(152_350, 60),
    level(152_355, 30),
    level(152_360, 15),
    level(152_365, 5),
  ],
  totalBidQty: 270,
  totalAskQty: 210,
  ts: TS,
};

export const indexSummaryFixture: IndexSummary = {
  token: 256265,
  symbol: 'NIFTY50',
  name: 'Nifty 50',
  exchange: 'NSE',
  value: 24_512_35,
  change: 118_20,
  changeBp: 48,
  sparkline: [24_394_15, 24_450_00, 24_512_35],
  ts: TS,
};

export const quoteRowFixture: QuoteRow = {
  token: 408065,
  symbol: 'INFY',
  exchange: 'NSE',
  name: 'Infosys Ltd',
  ltp: 152_345,
  change: -1_255,
  changeBp: -82,
};

export const stockListFixture: StockList = {
  id: 'top-it',
  title: 'Top IT',
  description: 'Largest IT services companies',
  items: [quoteRowFixture],
};

export const moversFixture: Movers = {
  index: 'NIFTY50',
  direction: 'losers',
  items: [quoteRowFixture],
  asOf: TS,
};

export const userFixture: User = {
  id: 'usr_demo',
  mobileMasked: '******3210',
  name: 'Demo User',
  email: 'demo@example.com',
  kycStatus: 'VERIFIED',
  pinSet: true,
  totpEnabled: false,
  createdAt: TS,
};

export const deviceFixture: Device = {
  id: 'dev_1',
  label: 'Chrome on macOS',
  trusted: true,
  current: true,
  createdAt: TS,
  lastSeenAt: TS,
};

export const sessionFixture: Session = {
  user: userFixture,
  device: deviceFixture,
  accessToken: 'fake-access-token',
  accessTokenExpiresAt: '2026-09-25T04:15:00.000Z',
};

export const otpRequestResponseFixture: OtpRequestResponse = {
  requestId: 'otp_1',
  resendAfterSec: 30,
  expiresAt: '2026-09-25T04:05:00.000Z',
};

export const otpVerifyFixture: OtpVerifyRequest = {
  requestId: 'otp_1',
  mobile: '9876543210',
  otp: '123456',
};

export const pinSetFixture: PinSetRequest = { pin: '4821', confirmPin: '4821' };

export const watchlistItemFixture = (token: number): WatchlistItem => ({
  token,
  symbol: `SYM${token}`,
  exchange: 'NSE',
  name: `Company ${token}`,
  addedAt: TS,
});

export const watchlistFixture: Watchlist = {
  id: 'wl_1',
  name: 'My Watchlist',
  items: [watchlistItemFixture(1), watchlistItemFixture(2)],
  createdAt: TS,
  updatedAt: TS,
};

export const placeLimitFixture: PlaceOrderRequest = {
  token: 408065,
  side: 'BUY',
  type: 'LIMIT',
  product: 'DELIVERY',
  qty: 10,
  price: 152_345,
  clientOrderId: 'c_1',
};

export const placeMarketFixture: PlaceOrderRequest = {
  token: 408065,
  side: 'SELL',
  type: 'MARKET',
  product: 'INTRADAY',
  qty: 1,
};

export const modifyOrderFixture: ModifyOrderRequest = { qty: 5, price: 152_300 };

export const orderFixture: Order = {
  id: 'ord_1',
  clientOrderId: 'c_1',
  token: 408065,
  symbol: 'INFY',
  exchange: 'NSE',
  side: 'BUY',
  type: 'LIMIT',
  product: 'DELIVERY',
  qty: 10,
  price: 152_345,
  filledQty: 10,
  avgFillPrice: 152_340,
  status: 'EXECUTED',
  statusReason: null,
  placedAt: TS,
  updatedAt: TS,
};

export const positionFixture: Position = {
  token: 408065,
  symbol: 'INFY',
  exchange: 'NSE',
  product: 'INTRADAY',
  netQty: -2,
  buyQty: 0,
  sellQty: 2,
  avgBuyPrice: 0,
  avgSellPrice: 153_000,
  ltp: 152_345,
  realisedPnl: 0,
  unrealisedPnl: 1_310,
};

export const holdingFixture: Holding = {
  token: 408065,
  symbol: 'INFY',
  exchange: 'NSE',
  qty: 10,
  avgPrice: 140_000,
  ltp: 152_345,
  investedValue: 1_400_000,
  currentValue: 1_523_450,
  pnl: 123_450,
  pnlBp: 882,
  dayChange: -12_550,
  dayChangeBp: -82,
};

export const portfolioSummaryFixture: PortfolioSummary = {
  investedValue: 1_400_000,
  currentValue: 1_523_450,
  totalPnl: 123_450,
  totalPnlBp: 882,
  dayPnl: -12_550,
  dayPnlBp: -82,
  holdingsCount: 1,
  positionsCount: 1,
  asOf: TS,
};

export const fundsSummaryFixture: FundsSummary = {
  openingBalance: 10_00_000_00,
  balance: 8_60_000_00,
  blocked: 15_234_50,
  available: 8_44_765_50,
  realisedPnlToday: 0,
  asOf: TS,
};

export const ledgerEntryFixture: LedgerEntry = {
  id: 'led_1',
  type: 'OPENING_CREDIT',
  amount: 10_00_000_00,
  balanceAfter: 10_00_000_00,
  orderId: null,
  description: 'Paper trading opening balance',
  createdAt: TS,
};

export const resetRequestFixture: ResetRequest = { confirm: 'RESET' };

export const wsClientFixtures: WsClientMessage[] = [
  { v: 1, type: 'subscribe', symbols: ['INFY', 'TCS'], exchange: 'NSE' },
  { v: 1, type: 'unsubscribe', symbols: ['TCS'], exchange: 'NSE' },
  { v: 1, type: 'ping', id: 7 },
];

export const wsServerFixtures: WsServerMessage[] = [
  { v: 1, type: 'quotes', quotes: [quoteFixture] },
  {
    v: 1,
    type: 'instruments',
    instruments: [
      {
        token: quoteFixture.token,
        symbol: quoteFixture.symbol,
        exchange: quoteFixture.exchange,
        open: quoteFixture.open,
        prevClose: quoteFixture.prevClose,
      },
    ],
  },
  { v: 1, type: 'orderUpdate', order: orderFixture },
  { v: 1, type: 'pong', id: 7 },
  {
    v: 1,
    type: 'error',
    code: 'SUBSCRIPTION_LIMIT',
    message: 'You can follow up to 200 symbols at once',
    symbols: ['WIPRO'],
  },
];
