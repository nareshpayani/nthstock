import type { Exchange, InstrumentToken, TradingSymbol } from '@nthstock/contracts';
import { assertPositivePaise } from './context.js';

/**
 * What the engine needs to know about an instrument besides its price: the names an `Order`
 * carries and today's circuit band in paise (`InstrumentStats.lowerCircuit` / `upperCircuit`).
 */
export type InstrumentInfo = {
  token: InstrumentToken;
  symbol: TradingSymbol;
  exchange: Exchange;
  lowerCircuit: number;
  upperCircuit: number;
};

/**
 * Where the engine looks instruments up. The mock market adapter feeds it in MSW and apps/api;
 * tests pass a map. Returns `null` for an unknown token.
 */
export interface InstrumentSource {
  getInstrument(token: InstrumentToken): InstrumentInfo | null;
}

/** An instrument source backed by a mutable map, for tests and simple wiring. */
export type MapInstrumentSource = InstrumentSource & {
  set(info: InstrumentInfo): void;
};

export function createMapInstrumentSource(
  initial: Iterable<InstrumentInfo> = [],
): MapInstrumentSource {
  const instruments = new Map<InstrumentToken, InstrumentInfo>();
  const set = (info: InstrumentInfo) => {
    assertPositivePaise(info.lowerCircuit, `Lower circuit of ${info.symbol}`);
    assertPositivePaise(info.upperCircuit, `Upper circuit of ${info.symbol}`);
    if (info.lowerCircuit > info.upperCircuit) {
      throw new RangeError(`Circuit band of ${info.symbol} is upside down`);
    }
    instruments.set(info.token, { ...info });
  };
  for (const info of initial) set(info);
  return { getInstrument: (token) => instruments.get(token) ?? null, set };
}
