import type { Instrument } from '@nthstock/contracts';
import type { StockDetailSearch } from '../model/stockDetailSearch';
import { useDocumentTitle } from '@/shared/hooks/useDocumentTitle';
import { strings } from '../strings';

export type StockDetailPageProps = {
  instrument: Instrument;
  /** URL state: chart range, exchange and chart type. */
  search?: StockDetailSearch;
  onSearchChange?: (patch: StockDetailSearch) => void;
};

/** Stock detail (E5): header, chart and key stats for one instrument on one exchange. */
export function StockDetailPage({ instrument }: StockDetailPageProps) {
  useDocumentTitle(strings.pageTitle(instrument.name, instrument.symbol));
  return (
    <div className="mx-auto grid w-full max-w-[1200px] grid-cols-[minmax(0,1fr)] gap-4 lg:gap-6">
      <div className="grid gap-1">
        <h1 className="text-title text-ink">{instrument.name}</h1>
        <p className="text-body text-ink-muted">
          {instrument.symbol} · {instrument.exchange} · {strings.instrumentType[instrument.type]}
        </p>
      </div>
    </div>
  );
}
