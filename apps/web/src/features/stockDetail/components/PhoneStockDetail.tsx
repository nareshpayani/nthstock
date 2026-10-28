import type { Instrument, OrderSide, Quote } from '@nthstock/contracts';
import { Button, Tabs, TabsContent, TabsList, TabsTrigger, TouchTargets, cn } from '@nthstock/ui';
import { useId, useState, useSyncExternalStore, type ReactNode } from 'react';
import { keepInterval } from '@/features/charts';
import { ScalperPad } from '@/features/scalper';
import { useOpenTicket } from '@/shared/hooks/useOpenTicket';
import { phoneChartHeight } from '@/shared/lib/phoneChart';
import {
  DEFAULT_CHART_TYPE,
  DEFAULT_STOCK_RANGE,
  type StockDetailSearch,
} from '../model/stockDetailSearch';
import { strings } from '../strings';
import { InstrumentOrders } from './InstrumentOrders';
import { KeyStatsCard } from './KeyStatsCard';
import { MarketDepthCard } from './MarketDepthCard';
import { OverviewCard } from './OverviewCard';
import { PositionStrip } from './PositionStrip';
import { SimulatorPanel } from './SimulatorPanel';
import { CHART_HEIGHT, StockChartCard } from './StockChartCard';
import { StockHeader } from './StockHeader';

const PHONE_TABS = ['overview', 'depth', 'orders'] as const;
type PhoneTab = (typeof PHONE_TABS)[number];

const subscribeResize = (onChange: () => void) => {
  window.addEventListener('resize', onChange);
  return () => window.removeEventListener('resize', onChange);
};
const viewportHeight = () => window.innerHeight;

export type PhoneStockDetailProps = {
  instrument: Instrument;
  snapshot: Quote | null | undefined;
  /** The snapshot request failed (the price block may show "Price unavailable"). */
  snapshotFailed?: boolean;
  onRetrySnapshot?: () => void;
  search: StockDetailSearch;
  onSearchChange: (patch: StockDetailSearch) => void;
  /** Wraps each card in its own error boundary, as on desktop. */
  section: (label: string, children: ReactNode) => ReactNode;
};

/**
 * The instrument page on a phone (T12, SPEC-TFC-1 §9.4), a deliberate layout and not a shrunk
 * desktop: the header, the chart at about half the screen with its range row, then Overview,
 * Depth and Orders tabs (the Demo simulator above them in demo mode), and at the bottom the position strip and a sticky Sell and Buy bar in
 * thumb reach, above the safe area. Every control is at least 44 px. Equities only; indices keep
 * the header and chart.
 */
export function PhoneStockDetail({
  instrument,
  snapshot,
  snapshotFailed = false,
  onRetrySnapshot,
  search,
  onSearchChange,
  section,
}: PhoneStockDetailProps) {
  const [tab, setTab] = useState<PhoneTab>('overview');
  const height = useSyncExternalStore(subscribeResize, viewportHeight, () => 800);
  const openTicket = useOpenTicket();
  const { symbol, exchange } = instrument;
  const trade = (side: OrderSide) => {
    void openTicket({ symbol, exchange, side });
  };
  // Scalper mode (T21, §11.1): the switch swaps Sell and Buy for the pad; the chart stays.
  const [scalp, setScalp] = useState(false);
  const scalpDescription = useId();
  const scalpSwitch = (
    <button
      type="button"
      role="switch"
      aria-checked={scalp}
      aria-describedby={scalpDescription}
      onClick={() => setScalp((on) => !on)}
      className={cn(
        'flex min-h-11 min-w-11 items-center gap-2 rounded-pill border px-3 text-body font-semibold',
        scalp ? 'border-brand bg-brand-soft text-brand' : 'border-line bg-surface text-ink',
      )}
    >
      <span
        aria-hidden="true"
        className={cn('size-2.5 rounded-pill', scalp ? 'bg-brand' : 'bg-ink-muted')}
      />
      {strings.phone.scalp}
      <span id={scalpDescription} hidden>
        {strings.phone.scalpDescription}
      </span>
    </button>
  );

  return (
    <TouchTargets>
      <div
        className="mx-auto grid w-full animate-content-in grid-cols-[minmax(0,1fr)] gap-3"
        data-layout="phone"
      >
        <StockHeader
          instrument={instrument}
          snapshot={snapshot}
          snapshotFailed={snapshotFailed}
          {...(onRetrySnapshot ? { onRetry: onRetrySnapshot } : {})}
          onExchangeChange={(next) => onSearchChange({ exchange: next })}
          phone
        />
        {section(
          strings.chart.title,
          <StockChartCard
            instrument={instrument}
            range={search.range ?? DEFAULT_STOCK_RANGE}
            chartType={search.chart ?? DEFAULT_CHART_TYPE}
            interval={search.interval}
            onRangeChange={(range) =>
              onSearchChange({ range, interval: keepInterval(range, search.interval) })
            }
            onIntervalChange={(interval) => onSearchChange({ interval })}
            onChartTypeChange={(chart) => onSearchChange({ chart })}
            height={height > 0 ? phoneChartHeight(height) : CHART_HEIGHT}
            controls="touch"
            trading
          />,
        )}
        {/* Demo mode only (TFC-12): under the chart, so a phone demo can ratchet and trigger a stop. */}
        {section(strings.simulator.label, <SimulatorPanel symbol={symbol} />)}
        <Tabs value={tab} onValueChange={(next) => setTab(next as PhoneTab)} className="grid gap-0">
          <TabsList aria-label={strings.phone.tabsLabel} className="gap-0">
            {PHONE_TABS.map((key) => (
              <TabsTrigger key={key} value={key} className="min-h-11 flex-1 px-3">
                {strings.phone.tabs[key]}
              </TabsTrigger>
            ))}
          </TabsList>
          <TabsContent value="overview" className="grid gap-3 pt-3">
            {section(
              strings.stats.title,
              <KeyStatsCard instrument={instrument} snapshot={snapshot} />,
            )}
            {section(strings.overview.title, <OverviewCard instrument={instrument} />)}
          </TabsContent>
          <TabsContent value="depth" className="pt-3">
            {section(strings.depth.title, <MarketDepthCard instrument={instrument} />)}
          </TabsContent>
          <TabsContent value="orders" className="pt-3">
            <InstrumentOrders instrument={instrument} />
          </TabsContent>
        </Tabs>
        {/*
        Sticky to the bottom of the screen, edge to edge (it cancels main's padding), clear of the
        iPhone home indicator: the primary actions stay in the lower part of the screen (§9.4).
      */}
        <div
          data-testid="phone-trade-bar"
          className="sticky bottom-0 z-(--nth-z-header) -mx-4 -mb-4 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)]"
        >
          <PositionStrip instrument={instrument} />
          {scalp ? (
            <>
              <ScalperPad instrument={instrument} />
              <div className="flex justify-end px-4 pb-3">{scalpSwitch}</div>
            </>
          ) : (
            <div
              role="group"
              aria-label={strings.phone.tradeBar(symbol)}
              className="grid grid-cols-[1fr_1fr_auto] gap-2 px-4 py-3"
            >
              <Button
                variant="sell"
                size="lg"
                aria-label={strings.header.sellLabel(symbol)}
                onClick={() => trade('SELL')}
              >
                {strings.header.sell}
              </Button>
              <Button
                variant="buy"
                size="lg"
                aria-label={strings.header.buyLabel(symbol)}
                onClick={() => trade('BUY')}
              >
                {strings.header.buy}
              </Button>
              {scalpSwitch}
            </div>
          )}
        </div>
      </div>
    </TouchTargets>
  );
}
