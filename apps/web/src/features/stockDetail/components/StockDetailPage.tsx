import type { Instrument } from '@nthstock/contracts';
import { useQuery } from '@tanstack/react-query';
import { useDocumentTitle } from '@/shared/hooks/useDocumentTitle';
import { useApiClient } from '@/shared/lib/apiClientContext';
import { quoteSnapshotQuery } from '../api/stockDetailQueries';
import type { StockDetailSearch } from '../model/stockDetailSearch';
import { strings } from '../strings';
import { StockHeader } from './StockHeader';

export type StockDetailPageProps = {
  instrument: Instrument;
  /** URL state: chart range, exchange and chart type. */
  search?: StockDetailSearch;
  onSearchChange?: (patch: StockDetailSearch) => void;
};

const ignore = () => undefined;

/** Stock detail (E5): header, chart and key stats for one instrument on one exchange. */
export function StockDetailPage({ instrument, onSearchChange = ignore }: StockDetailPageProps) {
  useDocumentTitle(strings.pageTitle(instrument.name, instrument.symbol));
  const api = useApiClient();
  const listing = { symbol: instrument.symbol, exchange: instrument.exchange };
  const snapshot = useQuery(quoteSnapshotQuery(api, listing));

  return (
    <div className="mx-auto grid w-full max-w-[1200px] grid-cols-[minmax(0,1fr)] gap-4 lg:gap-6">
      <StockHeader
        instrument={instrument}
        snapshot={snapshot.data}
        onExchangeChange={(exchange) => onSearchChange({ exchange })}
      />
    </div>
  );
}
