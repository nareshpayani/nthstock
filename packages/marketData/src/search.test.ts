import { describe, expect, it } from 'vitest';
import { SearchIndex } from './search.js';
import { allInstruments, generateSymbolMaster } from './symbolMaster.js';

const master = generateSymbolMaster();
const index = new SearchIndex(allInstruments(master));
const symbols = (q: string, limit?: number) => index.search(q, limit).map((h) => h.symbol);

describe('SearchIndex', () => {
  it('"inf" returns INFY first', () => {
    expect(symbols('inf')[0]).toBe('INFY');
  });

  it('ranks an exact symbol first, then symbol prefixes, then name tokens', () => {
    const hits = symbols('tcs', 20);
    expect(hits[0]).toBe('TCS');
    // Symbol prefixes rank by market cap.
    expect(symbols('HDFC', 2)).toEqual(['HDFCBANK', 'HDFCLIFE']);
    // "bank": symbols starting BANK first (BANKBARODA), then names with a word starting "bank".
    const bank = index.search('bank', 20);
    expect(bank[0]?.symbol).toBe('BANKBARODA');
    expect(bank.map((h) => h.symbol)).toContain('HDFCBANK');
    const prefixCount = bank.filter((h) => h.symbol.startsWith('BANK')).length;
    expect(bank.slice(0, prefixCount).every((h) => h.symbol.startsWith('BANK'))).toBe(true);
    expect(bank.slice(prefixCount).every((h) => /\bbank/i.test(h.name))).toBe(true);
  });

  it('matches multi-word names and compact index symbols', () => {
    expect(symbols('state bank')[0]).toBe('SBIN');
    expect(symbols('nifty 50')[0]).toBe('NIFTY50');
    expect(symbols('m&m')[0]).toBe('M&M');
    expect(symbols('  Infosys ')[0]).toBe('INFY');
  });

  it('respects the limit, capped at 50, and returns nothing for blank or unmatched queries', () => {
    expect(symbols('a', 3)).toHaveLength(3);
    expect(symbols('a', 500)).toHaveLength(50);
    expect(symbols('a', 0)).toHaveLength(1);
    expect(symbols('a')).toHaveLength(10);
    expect(symbols('   ')).toEqual([]);
    expect(symbols('zzzzqqqq')).toEqual([]);
  });

  it('returns contract search hits', () => {
    expect(index.search('INFY', 1)).toEqual([
      {
        token: master.equityBySymbol.get('INFY')?.instrument.token,
        symbol: 'INFY',
        exchange: 'NSE',
        name: 'Infosys Ltd',
        type: 'EQUITY',
      },
    ]);
  });

  it('answers a query over 5,000 symbols in under 5 ms at p95', () => {
    expect(master.equities.length).toBeGreaterThanOrEqual(4_950);
    const now = (): number =>
      (globalThis as unknown as { performance: { now(): number } }).performance.now();
    const queries = ['inf', 'reliance', 'bank', 'tata mo', 'x', 'sharma pharma', 'zzz', 'NIFTY'];
    for (let i = 0; i < 200; i += 1) index.search(queries[i % queries.length] as string);
    const timings: number[] = [];
    for (let i = 0; i < 800; i += 1) {
      const start = now();
      index.search(queries[i % queries.length] as string, 10);
      timings.push(now() - start);
    }
    timings.sort((a, b) => a - b);
    const p95 = timings[Math.floor(timings.length * 0.95)] as number;
    expect(p95).toBeLessThan(5);
  });
});
