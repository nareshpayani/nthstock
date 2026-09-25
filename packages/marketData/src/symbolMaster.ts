import { Faker, base, en, en_IN } from '@faker-js/faker';
import type { Instrument } from '@nthstock/contracts';
import { TICK_SIZE_PAISE } from '@nthstock/contracts';
import { LISTED_COMPANIES, NIFTY_50, NIFTY_BANK, NIFTY_IT, SENSEX_30 } from './largeCaps.js';
import { roundToTick } from './price.js';
import {
  hashSeed,
  mulberry32,
  mulberry32Randomizer,
  pick,
  randomBetween,
  randomNormal,
  type Rng,
} from './prng.js';
import { SECTORS, SECTOR_GBM, SECTOR_NAMING, type Sector } from './sectors.js';

export const DEFAULT_SEED = 20260925;
export const DEFAULT_EQUITY_COUNT = 5000;

/** Paise in one crore rupees (₹1,00,00,000 × 100). */
const PAISE_PER_CRORE = 1_000_000_000;

/** Market-cap buckets by full market cap (₹ crore): large ≥ 50,000, mid ≥ 5,000, small below. */
export type MarketCapBucket = 'LARGE' | 'MID' | 'SMALL';
export const LARGE_CAP_MIN_CRORE = 50_000;
export const MID_CAP_MIN_CRORE = 5_000;

export function marketCapBucket(marketCapCrore: number): MarketCapBucket {
  if (marketCapCrore >= LARGE_CAP_MIN_CRORE) return 'LARGE';
  if (marketCapCrore >= MID_CAP_MIN_CRORE) return 'MID';
  return 'SMALL';
}

/** One equity in the master: the contract `Instrument` plus what the simulator needs. */
export type MasterEquity = {
  instrument: Instrument;
  sector: Sector;
  capBucket: MarketCapBucket;
  /** Previous close at the start of the simulation, in paise, on the 5-paise tick. */
  basePrice: number;
  sharesOutstanding: number;
  /** Dividend yield in basis points (0 for non-payers). */
  dividendYieldBp: number;
  /** P/E × 100, or null when earnings are negative or not meaningful. */
  peX100: number | null;
  /** Simulated trailing one-year return in basis points (drives "Best Returns" and 1Y candles). */
  return1yBp: number;
  /** 0 = largest by market cap; used to rank search results and lists. */
  rank: number;
  /** True for the hand-listed large and mid caps. */
  listed: boolean;
};

export type MasterIndex = {
  instrument: Instrument;
  /** Level at the previous close, in hundredths of a point (the IndexSummary scale). */
  baseLevel: number;
  constituents: readonly string[];
};

export type SymbolMaster = {
  seed: number;
  equities: readonly MasterEquity[];
  indices: readonly MasterIndex[];
  equityBySymbol: ReadonlyMap<string, MasterEquity>;
  indexBySymbol: ReadonlyMap<string, MasterIndex>;
};

export type SymbolMasterOptions = {
  seed?: number;
  /** Total equities including the hand-listed ones. Default 5,000. */
  equityCount?: number;
};

/** Index definitions: symbol, display name, exchange, previous-close level in points. */
const INDEX_DEFS = [
  { symbol: 'NIFTY50', name: 'NIFTY 50', exchange: 'NSE', level: 25_000 },
  { symbol: 'SENSEX', name: 'SENSEX', exchange: 'BSE', level: 81_500 },
  { symbol: 'NIFTYBANK', name: 'NIFTY BANK', exchange: 'NSE', level: 55_000 },
  { symbol: 'NIFTYIT', name: 'NIFTY IT', exchange: 'NSE', level: 35_000 },
  { symbol: 'NIFTYMIDCAP100', name: 'NIFTY MIDCAP 100', exchange: 'NSE', level: 57_000 },
] as const;

/** Tokens for indices start here so they never collide with equity tokens. */
export const INDEX_TOKEN_BASE = 900_001;
const MIDCAP_100_SIZE = 100;
const GENERATED_MID_CAPS = 150;

/** A deterministic, well-formed ISIN-shaped code (`INE` + 6 digits + `01` + 1 digit). Not a real ISIN. */
function mockIsin(token: number): string {
  return `INE${String(token).padStart(6, '0')}01${String(token % 10)}`;
}

function equityInstrument(token: number, symbol: string, name: string, sector: Sector): Instrument {
  return {
    token,
    symbol,
    exchange: 'NSE',
    name,
    type: 'EQUITY',
    isin: mockIsin(token),
    sector,
    lotSize: 1,
    tickSize: TICK_SIZE_PAISE,
  };
}

function simulatedReturn1yBp(rng: Rng, sector: Sector, volScale: number): number {
  const { drift, volatility } = SECTOR_GBM[sector];
  const sigma = volatility * volScale;
  const growth = Math.exp(drift - (sigma * sigma) / 2 + sigma * randomNormal(rng));
  return Math.max(-8_000, Math.round((growth - 1) * 10_000));
}

function logUniform(rng: Rng, min: number, max: number): number {
  return Math.exp(randomBetween(rng, Math.log(min), Math.log(max)));
}

/** Letters only, uppercase: "Mehrotra-Kaur" → "MEHROTRAKAUR". */
function lettersOf(text: string): string {
  return text.toUpperCase().replace(/[^A-Z]/g, '');
}

type Draft = Omit<MasterEquity, 'rank' | 'instrument'> & {
  symbol: string;
  name: string;
};

function listedDrafts(rng: Rng): Draft[] {
  return LISTED_COMPANIES.map(([symbol, name, sector, priceRupees, capCrore, divBp, pe]) => {
    const basePrice = roundToTick(priceRupees * 100);
    return {
      symbol,
      name,
      sector,
      capBucket: marketCapBucket(capCrore),
      basePrice,
      sharesOutstanding: Math.round((capCrore * PAISE_PER_CRORE) / basePrice),
      dividendYieldBp: divBp,
      peX100: pe === null ? null : pe * 100,
      return1yBp: simulatedReturn1yBp(rng, sector, 1),
      listed: true,
    };
  });
}

function generatedDrafts(rng: Rng, seed: number, count: number, taken: Set<string>): Draft[] {
  // Faker draws from the same mulberry32 stream family, so the master is fully seed-determined.
  const faker = new Faker({ locale: [en_IN, en, base], randomizer: mulberry32Randomizer(seed) });
  // Small name pools keep generation fast (well under the 200 ms budget) while reading as Indian.
  // Single plain words only, so names read "Mehrotra Chemicals Ltd", not "Abbott-Abbott …".
  const plain = (words: string[]) => words.filter((w) => /^[A-Za-z]{3,}$/.test(w));
  const surnames = plain(Array.from({ length: 400 }, () => faker.person.lastName()));
  const places = plain(Array.from({ length: 150 }, () => faker.location.city()));
  const drafts: Draft[] = [];

  for (let i = 0; i < count; i += 1) {
    const sector = pick(rng, SECTORS);
    const naming = SECTOR_NAMING[sector];
    const stem = rng() < 0.75 ? pick(rng, surnames) : pick(rng, places);
    const name = `${stem} ${pick(rng, naming.words)} Ltd`;
    let symbol = `${(lettersOf(stem) || 'NTH').slice(0, 7)}${naming.code}`;
    for (let n = 2; taken.has(symbol); n += 1) symbol = `${symbol.replace(/\d+$/, '')}${String(n)}`;
    taken.add(symbol);

    const isMid = i < GENERATED_MID_CAPS;
    const capCrore = isMid
      ? logUniform(rng, MID_CAP_MIN_CRORE, 45_000)
      : logUniform(rng, 100, 4_900);
    const basePrice = roundToTick(logUniform(rng, isMid ? 2_000 : 500, isMid ? 400_000 : 200_000));
    const payer = rng() < 0.65;
    const profitable = rng() < 0.88;
    drafts.push({
      symbol,
      name,
      sector,
      capBucket: marketCapBucket(capCrore),
      basePrice,
      sharesOutstanding: Math.max(1, Math.round((capCrore * PAISE_PER_CRORE) / basePrice)),
      dividendYieldBp: payer ? Math.round(randomBetween(rng, 10, isMid ? 450 : 600)) : 0,
      peX100: profitable ? Math.round(randomBetween(rng, 6, 90) * 100) : null,
      return1yBp: simulatedReturn1yBp(rng, sector, isMid ? 1.2 : 1.5),
      listed: false,
    });
  }
  return drafts;
}

const marketCapOf = (e: { basePrice: number; sharesOutstanding: number }) =>
  e.basePrice * e.sharesOutstanding;

/**
 * Builds the seeded symbol master: ~100 hand-listed NSE large and mid caps plus faker-generated
 * equities up to `equityCount`, and the five indices with their constituents.
 */
export function generateSymbolMaster(options: SymbolMasterOptions = {}): SymbolMaster {
  const seed = options.seed ?? DEFAULT_SEED;
  const equityCount = Math.max(
    options.equityCount ?? DEFAULT_EQUITY_COUNT,
    LISTED_COMPANIES.length,
  );
  const rng = mulberry32(hashSeed(seed, 'master'));

  const listed = listedDrafts(rng);
  const taken = new Set(listed.map((d) => d.symbol));
  const generated = generatedDrafts(
    rng,
    hashSeed(seed, 'faker'),
    equityCount - listed.length,
    taken,
  );

  // Rank by market cap (ties by symbol) so tokens, search ranking and lists are stable.
  const drafts = [...listed, ...generated].sort(
    (a, b) => marketCapOf(b) - marketCapOf(a) || a.symbol.localeCompare(b.symbol),
  );
  const equities: MasterEquity[] = drafts.map(({ symbol, name, ...rest }, rank) => ({
    ...rest,
    rank,
    instrument: equityInstrument(rank + 1, symbol, name, rest.sector),
  }));
  const equityBySymbol = new Map(equities.map((e) => [e.instrument.symbol, e]));

  const midcap100 = equities
    .filter((e) => e.capBucket === 'MID')
    .slice(0, MIDCAP_100_SIZE)
    .map((e) => e.instrument.symbol);
  const constituentsBySymbol: Record<(typeof INDEX_DEFS)[number]['symbol'], readonly string[]> = {
    NIFTY50: NIFTY_50,
    SENSEX: SENSEX_30,
    NIFTYBANK: NIFTY_BANK,
    NIFTYIT: NIFTY_IT,
    NIFTYMIDCAP100: midcap100,
  };

  const indices: MasterIndex[] = INDEX_DEFS.map((def, i) => ({
    instrument: {
      token: INDEX_TOKEN_BASE + i,
      symbol: def.symbol,
      exchange: def.exchange,
      name: def.name,
      type: 'INDEX',
      isin: null,
      sector: null,
      lotSize: 1,
      tickSize: TICK_SIZE_PAISE,
    },
    baseLevel: def.level * 100,
    constituents: constituentsBySymbol[def.symbol],
  }));

  return {
    seed,
    equities,
    indices,
    equityBySymbol,
    indexBySymbol: new Map(indices.map((ix) => [ix.instrument.symbol, ix])),
  };
}

/** Every instrument in the master: indices first, then equities by market cap. */
export function allInstruments(master: SymbolMaster): Instrument[] {
  return [
    ...master.indices.map((ix) => ix.instrument),
    ...master.equities.map((e) => e.instrument),
  ];
}
