import type { Exchange, Instrument } from '@nthstock/contracts';
import { useQuery } from '@tanstack/react-query';
import { useApiClient } from '@/shared/lib/apiClientContext';
import { listingsQuery } from '../api/stockDetailQueries';

export const EXCHANGES = ['NSE', 'BSE'] as const satisfies readonly Exchange[];

const otherExchange = (exchange: Exchange): Exchange => (exchange === 'NSE' ? 'BSE' : 'NSE');

/**
 * Which exchanges list this symbol (T-106): the one on screen, plus the other if the symbol master
 * has it there. One symbol search answers for both exchanges; the other is `false` until it
 * arrives, so the toggle never offers a page that does not exist.
 */
export type ExchangeListings = {
  /** Exchanges the toggle may switch to. */
  listed: Record<Exchange, boolean>;
  /** Exchanges known not to list the symbol (the search found no listing there, or failed). */
  unlisted: Exchange[];
};

export function useExchangeListings(instrument: Instrument): ExchangeListings {
  const api = useApiClient();
  const other = otherExchange(instrument.exchange);
  const lookup = useQuery({ ...listingsQuery(api, instrument.symbol), retry: false });
  const otherListed = lookup.data?.includes(other) ?? false;
  const listed = { NSE: false, BSE: false };
  listed[instrument.exchange] = true;
  listed[other] = otherListed;
  const known = lookup.isError || (lookup.isSuccess && !otherListed);
  return { listed, unlisted: known ? [other] : [] };
}
