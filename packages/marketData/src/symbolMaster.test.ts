import { Instrument } from '@nthstock/contracts';
import { describe, expect, it } from 'vitest';
import { LISTED_COMPANIES } from './largeCaps.js';
import {
  DEFAULT_SEED,
  INDEX_TOKEN_BASE,
  allInstruments,
  generateSymbolMaster,
  marketCapBucket,
} from './symbolMaster.js';

const master = generateSymbolMaster();

describe('generateSymbolMaster', () => {
  it('has 4,950–5,050 unique symbols', () => {
    const symbols = allInstruments(master).map((i) => i.symbol);
    expect(symbols.length).toBeGreaterThanOrEqual(4_950);
    expect(symbols.length).toBeLessThanOrEqual(5_050);
    expect(new Set(symbols).size).toBe(symbols.length);
  });

  it('generates in under 200 ms', () => {
    generateSymbolMaster({ seed: 1 }); // warm up the JIT
    const timings = [2, 3, 4].map((seed) => {
      const start = Date.now();
      generateSymbolMaster({ seed });
      return Date.now() - start;
    });
    expect(Math.min(...timings)).toBeLessThan(200);
  });

  it('has the five indices, and every constituent exists in the master', () => {
    expect(master.indices.map((ix) => ix.instrument.symbol)).toEqual([
      'NIFTY50',
      'SENSEX',
      'NIFTYBANK',
      'NIFTYIT',
      'NIFTYMIDCAP100',
    ]);
    const sizes = master.indices.map((ix) => ix.constituents.length);
    expect(sizes).toEqual([50, 30, 12, 10, 100]);
    for (const ix of master.indices) {
      expect(new Set(ix.constituents).size).toBe(ix.constituents.length);
      for (const symbol of ix.constituents) expect(master.equityBySymbol.has(symbol)).toBe(true);
    }
  });

  it('includes every hand-listed large cap with its real symbol and name', () => {
    expect(new Set(LISTED_COMPANIES.map(([s]) => s)).size).toBe(LISTED_COMPANIES.length);
    expect(LISTED_COMPANIES.length).toBeGreaterThanOrEqual(95);
    const infy = master.equityBySymbol.get('INFY');
    expect(infy?.instrument.name).toBe('Infosys Ltd');
    expect(infy?.capBucket).toBe('LARGE');
    expect(infy?.listed).toBe(true);
    expect(master.equityBySymbol.get('M&M')?.instrument.symbol).toBe('M&M');
  });

  it('gives every equity a sector, bucket, base price on the 5-paise tick and valid contract shape', () => {
    for (const instrument of allInstruments(master)) Instrument.parse(instrument);
    for (const e of master.equities) {
      expect(e.instrument.sector).toBe(e.sector);
      expect(Number.isInteger(e.basePrice)).toBe(true);
      expect(e.basePrice % 5).toBe(0);
      expect(e.basePrice).toBeGreaterThan(0);
      expect(e.instrument.tickSize).toBe(5);
      expect(Number.isSafeInteger(e.basePrice * e.sharesOutstanding)).toBe(true);
    }
    const buckets = new Set(master.equities.map((e) => e.capBucket));
    expect(buckets).toEqual(new Set(['LARGE', 'MID', 'SMALL']));
  });

  it('orders equities by market cap with tokens following rank, indices on their own range', () => {
    master.equities.forEach((e, i) => {
      expect(e.rank).toBe(i);
      expect(e.instrument.token).toBe(i + 1);
    });
    expect(master.indices[0]?.instrument.token).toBe(INDEX_TOKEN_BASE);
    expect(master.indexBySymbol.get('SENSEX')?.instrument.exchange).toBe('BSE');
  });

  it('is deterministic for a seed and differs across seeds', () => {
    const again = generateSymbolMaster({ seed: DEFAULT_SEED });
    expect(again.equities.map((e) => e.instrument.symbol)).toEqual(
      master.equities.map((e) => e.instrument.symbol),
    );
    expect(again.equities.map((e) => e.basePrice)).toEqual(master.equities.map((e) => e.basePrice));
    const other = generateSymbolMaster({ seed: 99 });
    expect(other.equities.map((e) => e.instrument.name)).not.toEqual(
      master.equities.map((e) => e.instrument.name),
    );
  });

  it('honours a smaller equity count but never drops the hand-listed companies', () => {
    expect(generateSymbolMaster({ equityCount: 300 }).equities).toHaveLength(300);
    expect(generateSymbolMaster({ equityCount: 10 }).equities).toHaveLength(
      LISTED_COMPANIES.length,
    );
  });
});

describe('marketCapBucket', () => {
  it('splits at ₹50,000 crore and ₹5,000 crore', () => {
    expect(marketCapBucket(50_000)).toBe('LARGE');
    expect(marketCapBucket(49_999)).toBe('MID');
    expect(marketCapBucket(5_000)).toBe('MID');
    expect(marketCapBucket(4_999)).toBe('SMALL');
  });
});
