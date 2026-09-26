import { SearchHit } from '@nthstock/contracts';
import { z } from 'zod';
import { safeStorage } from '@/shared/lib/safeStorage';

export const RECENT_SEARCHES_KEY = 'nthstock.search.recent';
export const RECENT_SEARCHES_MAX = 5;

const RecentSearches = z.array(SearchHit).max(50);

/** Stocks the viewer opened from search, newest first. Bad or missing storage reads as none. */
export function readRecentSearches(): SearchHit[] {
  const raw = safeStorage.get(RECENT_SEARCHES_KEY);
  if (raw === null) return [];
  try {
    const parsed = RecentSearches.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data.slice(0, RECENT_SEARCHES_MAX) : [];
  } catch {
    return [];
  }
}

/** Puts `hit` first, drops an older copy of the same listing and keeps the newest five. */
export function addRecentSearch(hit: SearchHit): SearchHit[] {
  const same = (other: SearchHit) => other.symbol === hit.symbol && other.exchange === hit.exchange;
  const next = [hit, ...readRecentSearches().filter((other) => !same(other))].slice(
    0,
    RECENT_SEARCHES_MAX,
  );
  safeStorage.set(RECENT_SEARCHES_KEY, JSON.stringify(next));
  return next;
}
