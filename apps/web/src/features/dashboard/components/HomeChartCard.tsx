import type { CandleInterval, CandleRange, OrderSide } from '@nthstock/contracts';
import { Button, ErrorState, SegmentedControl } from '@nthstock/ui';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { IndexChartCard, type PriceChartType } from '@/features/charts';
import { PositionStrip, StockChartCard, instrumentQuery } from '@/features/stockDetail';
import { ChartSkeleton } from '@/shared/components/ChartSkeleton';
import { useOpenTicket } from '@/shared/hooks/useOpenTicket';
import { usePhoneShell } from '@/shared/hooks/usePhoneLayout';
import { useApiClient } from '@/shared/lib/apiClientContext';
import { HOME_CHART_SYMBOLS, type HomeChartSymbol } from '../model/dashboardSearch';
import { strings } from '../strings';

/** The phone chart's height: tall enough to drag order lines with a thumb, short enough for Home. */
const PHONE_CHART_HEIGHT = 320;
/**
 * The loaded card's height with no position (name row, chart with its controls, Buy and Sell), in
 * px. The card holds it while the stock loads, so Home below does not jump (CLS < 0.05, T-101).
 */
const PHONE_CARD_HEIGHT = 544;
const DESKTOP_CARD_HEIGHT = 524;

export type HomeChartCardProps = {
  symbol: HomeChartSymbol;
  onSymbolChange: (symbol: HomeChartSymbol) => void;
  range: CandleRange;
  interval?: CandleInterval | undefined;
  chartType: PriceChartType;
  onRangeChange: (range: CandleRange) => void;
  onIntervalChange: (interval: CandleInterval) => void;
  onChartTypeChange: (type: PriceChartType) => void;
};

/**
 * The dashboard's first chart (NSTOCK-0476): a stock you can trade right on it, HDFCBANK unless
 * the reader picks PAYTM or RELIANCE, with the stock page's order lines, drag to set a price,
 * the position strip and Buy and Sell under it. NIFTY 50 stays one tap away in the same picker.
 */
export function HomeChartCard({ symbol, onSymbolChange, ...chart }: HomeChartCardProps) {
  const phone = usePhoneShell();
  const picker = (
    <div className="-mx-1 overflow-x-auto px-1 pb-1">
      <SegmentedControl
        label={strings.homeChart.pickerLabel}
        options={HOME_CHART_SYMBOLS.map((value) => ({
          value,
          label: strings.homeChart.symbols[value],
          ariaLabel: strings.homeChart.symbolNames[value],
        }))}
        value={symbol}
        onValueChange={onSymbolChange}
        size={phone ? 'touch' : 'sm'}
      />
    </div>
  );
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-2">
      {picker}
      {symbol === 'NIFTY50' ? (
        <IndexChartCard
          range={chart.range}
          interval={chart.interval}
          chartType={chart.chartType}
          onRangeChange={chart.onRangeChange}
          onIntervalChange={chart.onIntervalChange}
          onChartTypeChange={chart.onChartTypeChange}
        />
      ) : (
        <TradeableChart key={symbol} symbol={symbol} phone={phone} {...chart} />
      )}
    </div>
  );
}

function TradeableChart({
  symbol,
  phone,
  range,
  interval,
  chartType,
  onRangeChange,
  onIntervalChange,
  onChartTypeChange,
}: Omit<HomeChartCardProps, 'symbol' | 'onSymbolChange'> & {
  symbol: Exclude<HomeChartSymbol, 'NIFTY50'>;
  phone: boolean;
}) {
  const api = useApiClient();
  const openTicket = useOpenTicket();
  const instrument = useQuery(instrumentQuery(api, { symbol, exchange: 'NSE' }));
  if (instrument.isError && !instrument.data) {
    return (
      <ErrorState
        title={strings.homeChart.errorTitle(symbol)}
        description={strings.homeChart.errorBody}
        retryLabel={strings.sectionError.retry}
        onRetry={() => void instrument.refetch()}
      />
    );
  }
  if (!instrument.data) {
    return (
      <ChartSkeleton
        height={phone ? PHONE_CARD_HEIGHT : DESKTOP_CARD_HEIGHT}
        label={strings.homeChart.loading(symbol)}
      />
    );
  }
  const stock = instrument.data;
  const trade = (side: OrderSide) =>
    void openTicket({ symbol: stock.symbol, exchange: stock.exchange, side });
  return (
    <section
      aria-label={strings.homeChart.sectionLabel(stock.symbol)}
      data-testid="dashboard-chart"
      style={{ minHeight: phone ? PHONE_CARD_HEIGHT : DESKTOP_CARD_HEIGHT }}
      className="grid grid-cols-[minmax(0,1fr)] content-start gap-2"
    >
      <div className="flex items-baseline justify-between gap-2">
        <Link
          to="/stocks/$symbol"
          params={{ symbol: stock.symbol }}
          className="truncate text-body font-semibold text-ink hover:text-brand"
        >
          {stock.name}
        </Link>
        <span className="shrink-0 text-label text-ink-muted">{strings.homeChart.hint}</span>
      </div>
      <StockChartCard
        instrument={stock}
        range={range}
        interval={interval}
        chartType={chartType}
        onRangeChange={onRangeChange}
        onIntervalChange={onIntervalChange}
        onChartTypeChange={onChartTypeChange}
        {...(phone ? { height: PHONE_CHART_HEIGHT, controls: 'touch' as const } : {})}
        trading
      />
      <PositionStrip instrument={stock} />
      <div
        role="group"
        aria-label={strings.homeChart.tradeLabel(stock.symbol)}
        className="grid grid-cols-2 gap-2"
      >
        <Button variant="sell" size="lg" onClick={() => trade('SELL')}>
          {strings.homeChart.sell(stock.symbol)}
        </Button>
        <Button variant="buy" size="lg" onClick={() => trade('BUY')}>
          {strings.homeChart.buy(stock.symbol)}
        </Button>
      </div>
    </section>
  );
}
