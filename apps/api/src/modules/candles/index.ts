// Public API of the candles module. Other modules and the app wiring import it only through this
// file; tests may import internals.
export { createCandleReader, type CandleReader, type LiveQuotes } from './reader.js';
export {
  CANDLE_AGGREGATES,
  refreshWithOwner,
  seedCandles,
  type CandleSeedOptions,
  type CandleSeedSummary,
} from './seed.js';
export {
  CANDLES_CONSUMER,
  CANDLES_GROUP,
  DEFAULT_IDLE_GRACE_MS,
  candlesWrittenKey,
  startCandleWriter,
  type CandleWriter,
  type CandleWriterLog,
  type CandleWriterOptions,
} from './candleWriter.js';
export {
  STORED_INTERVALS,
  createPgCandleStore,
  type CandleStore,
  type StoredBar,
  type StoredInterval,
} from './store.js';
