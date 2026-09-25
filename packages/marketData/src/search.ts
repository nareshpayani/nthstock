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

/** Index of the first item in `sorted` that is not below `key`. */
function lowerBound(sorted: readonly { key: string }[], key: string): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if ((sorted[mid] as { key: string }).key < key) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Ranks (positions in `entries`) of every key in `sorted` that starts with `prefix`. */
function ranksWithPrefix(
  sorted: readonly { key: string; rank: number }[],
  prefix: string,
): number[] {
  const ranks: number[] = [];
  for (let i = lowerBound(sorted, prefix); i < sorted.length; i += 1) {
    const item = sorted[i] as { key: string; rank: number };
    if (!item.key.startsWith(prefix)) break;
    ranks.push(item.rank);
  }
  return ranks;
}

const byKey = (a: { key: string }, b: { key: string }): number =>
  a.key < b.key ? -1 : a.key > b.key ? 1 : 0;

/**
 * In-memory instrument search. Ranks exact symbol matches first, then symbol prefix matches, then
 * names where every query word starts a word of the name. Within a tier, the order the instruments
 * were given in wins (pass them most important first, e.g. by market cap).
 *
 * Symbols and name words are kept in sorted arrays, so a query is a few binary searches plus the
 * matches themselves, not a scan of every instrument.
 */
export class SearchIndex {
  private readonly entries: Entry[];
  private readonly rankBySymbol: Map<string, number>;
  private readonly symbols: { key: string; rank: number }[];
  private readonly nameWords: { key: string; rank: number }[];

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
    this.rankBySymbol = new Map(this.entries.map((e, rank) => [e.symbol, rank]));
    this.symbols = this.entries.map((e, rank) => ({ key: e.symbol, rank })).sort(byKey);
    this.nameWords = this.entries
      .flatMap((e, rank) => [...new Set(e.nameTokens)].map((key) => ({ key, rank })))
      .sort(byKey);
  }

  search(query: string, limit: number = SEARCH_LIMIT_DEFAULT): SearchHit[] {
    const max = Math.min(Math.max(1, Math.floor(limit)), SEARCH_LIMIT_MAX);
    const q = query.trim().toUpperCase();
    if (q.length === 0) return [];
    const words = tokens(q);
    const compact = q.replace(/\s+/g, '');

    const exactRank = this.rankBySymbol.get(compact);
    const exact = exactRank === undefined ? undefined : this.entries[exactRank];
    const taken = new Set<number>();
    if (exactRank !== undefined) taken.add(exactRank);

    const prefix = ranksWithPrefix(this.symbols, compact)
      .filter((rank) => !taken.has(rank))
      .sort((a, b) => a - b);
    for (const rank of prefix) taken.add(rank);

    let named: number[] = [];
    if (words.length > 0) {
      // Ranks whose name has a word starting with every query word: intersect per-word matches.
      let matches: Set<number> | undefined;
      for (const word of words) {
        const ranks = new Set(ranksWithPrefix(this.nameWords, word));
        matches = matches ? new Set([...matches].filter((rank) => ranks.has(rank))) : ranks;
        if (matches.size === 0) break;
      }
      named = [...(matches ?? [])].filter((rank) => !taken.has(rank)).sort((a, b) => a - b);
    }

    return [
      ...(exact ? [exact] : []),
      ...prefix.map((r) => this.entries[r] as Entry),
      ...named.map((r) => this.entries[r] as Entry),
    ]
      .slice(0, max)
      .map((e) => e.hit);
  }
}
