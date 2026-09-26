import type { Exchange, Instrument } from '@nthstock/contracts';
import { useQuery } from '@tanstack/react-query';
import { useApiClient } from '@/shared/lib/apiClientContext';
import { instrumentQuery } from '../api/stockDetailQueries';

export const EXCHANGES = ['NSE', 'BSE'] as const satisfies readonly Exchange[];

const otherExchange = (exchange: Exchange): Exchange => (exchange === 'NSE' ? 'BSE' : 'NSE');

/**
 * Which exchanges list this symbol (T-106): the one on screen, plus the other if the symbol master
 * has it there. The other exchange is looked up once (a 404 means "not listed") and is `false`
 * until the answer arrives, so the toggle never offers a page that does not exist.
 */
export type ExchangeListings = {
  /** Exchanges the toggle may switch to. */
  listed: Record<Exchange, boolean>;
  /** Exchanges known not to list the symbol (the lookup answered 404 or failed). */
  unlisted: Exchange[];
};

export function useExchangeListings(instrument: Instrument): ExchangeListings {
  const api = useApiClient();
  const other = otherExchange(instrument.exchange);
  const lookup = useQuery({
    ...instrumentQuery(api, { symbol: instrument.symbol, exchange: other }),
    retry: false,
  });
  const listed = { NSE: false, BSE: false };
  listed[instrument.exchange] = true;
  listed[other] = lookup.isSuccess;
  return { listed, unlisted: lookup.isError ? [other] : [] };
}
