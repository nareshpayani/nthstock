import type { InstrumentToken, IsoUtc } from '@nthstock/contracts';
import type { Clock } from '@nthstock/utils';

/**
 * Where the engine reads the last traded price (LTP) of an instrument, in integer paise.
 * The mock market adapter feeds it in the browser (MSW) and in apps/api; tests pass a scripted one.
 * Returns `null` when the instrument has no price yet.
 */
export interface PriceSource {
  getLtp(token: InstrumentToken): number | null;
}

/** Issues opaque ids (orders, ledger entries). Injected so runs are reproducible. */
export type IdGenerator = () => string;

export type EngineDeps = {
  clock: Clock;
  prices: PriceSource;
  /** Defaults to `createSequentialIds()`. */
  nextId?: IdGenerator;
};

/**
 * Everything the engine may read from the outside world. The engine never touches `Date.now()`,
 * `Math.random()`, timers or any Node or DOM API, so it runs unchanged in the browser and in Node
 * (ADR 0004).
 */
export type EngineContext = {
  now(): Date;
  /** `now()` as an ISO 8601 UTC string, the shape every contract timestamp uses. */
  nowIso(): IsoUtc;
  /** LTP in paise, or `null` when unknown. Throws if the source returns anything but a positive integer. */
  ltp(token: InstrumentToken): number | null;
  nextId(): string;
};

export function createEngineContext(deps: EngineDeps): EngineContext {
  const nextId = deps.nextId ?? createSequentialIds();
  return {
    now: () => deps.clock.now(),
    nowIso: () => deps.clock.now().toISOString(),
    ltp: (token) => {
      const price = deps.prices.getLtp(token);
      if (price === null) return null;
      assertPositivePaise(price, `LTP for token ${String(token)}`);
      return price;
    },
    nextId,
  };
}

/** Ids `<prefix>1`, `<prefix>2`, … Deterministic, so tests and seeded demos are reproducible. */
export function createSequentialIds(prefix = 'pe'): IdGenerator {
  let n = 0;
  return () => {
    n += 1;
    return `${prefix}${String(n)}`;
  };
}

/** A price source backed by a mutable map, for tests, scripted price paths and simple wiring. */
export type MapPriceSource = PriceSource & {
  set(token: InstrumentToken, ltp: number): void;
  delete(token: InstrumentToken): void;
};

export function createMapPriceSource(
  initial: Iterable<readonly [InstrumentToken, number]> = [],
): MapPriceSource {
  const prices = new Map<InstrumentToken, number>();
  const set = (token: InstrumentToken, ltp: number) => {
    assertPositivePaise(ltp, `LTP for token ${String(token)}`);
    prices.set(token, ltp);
  };
  for (const [token, ltp] of initial) set(token, ltp);
  return {
    getLtp: (token) => prices.get(token) ?? null,
    set,
    delete: (token) => {
      prices.delete(token);
    },
  };
}

/** Money is integer paise, never a float (CLAUDE.md §6). */
export function assertPaise(value: number, what: string): void {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${what} must be an integer number of paise, got ${String(value)}`);
  }
}

export function assertPositivePaise(value: number, what: string): void {
  assertPaise(value, what);
  if (value <= 0) throw new RangeError(`${what} must be positive, got ${String(value)}`);
}

export function assertQty(value: number, what: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${what} must be a whole number of at least 1, got ${String(value)}`);
  }
}
