export {
  assertPaise,
  assertPositivePaise,
  assertQty,
  createEngineContext,
  createManualClock,
  createMapPriceSource,
  createSequentialIds,
  type EngineContext,
  type EngineDeps,
  type IdGenerator,
  type ManualClock,
  type MapPriceSource,
  type PriceSource,
} from './context.js';
export {
  firstFillOnPath,
  matchFill,
  type Fill,
  type MatchableOrder,
  type PathFill,
} from './fillMatcher.js';
export {
  createMapInstrumentSource,
  type InstrumentInfo,
  type InstrumentSource,
  type MapInstrumentSource,
} from './instruments.js';
export {
  intradayWindowOpen,
  isRequestError,
  validateOrder,
  type OrderDraft,
  type OrderRejectionCode,
  type ValidationContext,
  type ValidationResult,
} from './orderValidation.js';
export {
  INITIAL_ORDER_STATUSES,
  ORDER_EVENTS,
  ORDER_TRANSITIONS,
  OrderTransitionError,
  illegalTransitionReason,
  isTerminalStatus,
  nextOrderStatus,
  transitionOrder,
  type OrderEvent,
} from './orderStateMachine.js';
export {
  PAPER_ENGINE_SNAPSHOT_VERSION,
  PAPER_ENGINE_WORKING_SET_VERSION,
  PaperEngine,
  type EngineHolding,
  type EnginePosition,
  type HoldingSale,
  type OrderActionErrorCode,
  type OrderActionResult,
  type PaperEngineOptions,
  type PaperEngineSnapshot,
  type PaperEngineSnapshotV1,
  type PaperEngineWorkingSet,
} from './paperEngine.js';
export {
  FundsLedger,
  type FundsLedgerOptions,
  type LedgerCarried,
  type LedgerResult,
} from './fundsLedger.js';
export {
  EMPTY_POSITION,
  applyTrade,
  applyTrades,
  averagePrice,
  basisPoints,
  holdingValues,
  mulDivRound,
  positionValues,
  unrealisedPnl,
  type HoldingLot,
  type HoldingValues,
  type PositionBook,
  type PositionValues,
  type Trade,
} from './positionMath.js';
export {
  PaperDesk,
  type DeskMarket,
  type EngineRegistry,
  type LedgerPageQuery,
  type OrdersPageQuery,
  type PaperDeskOptions,
} from './paperDesk.js';
export { orderApiError, type OrderApiError } from './orderErrors.js';
export {
  DEMO_SEEDED_AT,
  DEMO_SEED_USER,
  DEMO_SYMBOLS,
  DEMO_TRADES,
  DEMO_WATCHLISTS,
  buildDemoAccount,
  demoPrice,
  demoWatchlists,
  type DemoInstrument,
  type DemoTrade,
  type DemoWatchlistDef,
} from './demoSeed.js';
