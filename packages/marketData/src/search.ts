import type { Instrument, SearchHit } from '@nthstock/contracts';
import { SEARCH_LIMIT_MAX } from '@nthstock/contracts';

export const SEARCH_LIMIT_DEFAULT = 10;

type Entry = { hit: SearchHit; symbol: string; nameTokens: readonly string[] };

function tokens(text: string): string[] {
  return text
    .toUpperCase()
    .split(/[^A-Z0-9&]+/)
    .filter((t) => t.length > 0);
}

/**
 * In-memory instrument search. Ranks exact symbol matches first, then symbol prefix matches, then
 * names where every query word starts a word of the name. Within a tier, the order the instruments
 * were given in wins (pass them most important first, e.g. by market cap).
 */
export class SearchIndex {
  private readonly entries: Entry[];
  private readonly bySymbol: Map<string, Entry>;

  constructor(instruments: readonly Instrument[]) {
    this.entries = instruments.map((instrument) => ({
      hit: {
        token: instrument.token,
        symbol: instrument.symbol,
        exchange: instrument.exchange,
        name: instrument.name,
        type: instrument.type,
      },
      symbol: instrument.symbol,
      nameTokens: tokens(instrument.name),
    }));
    this.bySymbol = new Map(this.entries.map((e) => [e.symbol, e]));
  }

  search(query: string, limit: number = SEARCH_LIMIT_DEFAULT): SearchHit[] {
    const max = Math.min(Math.max(1, Math.floor(limit)), SEARCH_LIMIT_MAX);
    const q = query.trim().toUpperCase();
    if (q.length === 0) return [];
    const words = tokens(q);
    const compact = q.replace(/\s+/g, '');

    // Entries are already in rank order, so each tier stays sorted as it fills.
    const exact = this.bySymbol.get(compact);
    const prefix: Entry[] = [];
    const named: Entry[] = [];
    const wanted = max - (exact ? 1 : 0);
    for (const entry of this.entries) {
      if (prefix.length >= wanted) break;
      if (entry === exact) continue;
      if (entry.symbol.startsWith(compact)) {
        prefix.push(entry);
      } else if (
        named.length < wanted &&
        words.length > 0 &&
        words.every((word) => entry.nameTokens.some((token) => token.startsWith(word)))
      ) {
        named.push(entry);
      }
    }
    return [...(exact ? [exact] : []), ...prefix, ...named].slice(0, max).map((e) => e.hit);
  }
}
