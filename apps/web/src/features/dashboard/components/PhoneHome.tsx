import type { Holding, MoverDirection } from '@nthstock/contracts';
import {
  Button,
  DigitRoll,
  IconPlus,
  IconTrade,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  buttonVariants,
} from '@nthstock/ui';
import { formatInr } from '@nthstock/utils';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { fundsSummaryQuery } from '@/features/funds';
import { holdingsQuery, useLiveHoldings } from '@/features/holdings';
import { MoversIndexPicker, MoversList } from '@/features/movers';
import { WatchlistSection } from '@/features/watchlist';
import { PnlAmount } from '@/shared/components/PnlAmount';
import { useSession } from '@/shared/hooks/useSession';
import { useApiClient } from '@/shared/lib/apiClientContext';
import { useSearchFocusStore } from '@/shared/lib/searchFocusStore';
import { useCountedValue } from '@/shared/motion/useCountedValue';
import type { DashboardSearch } from '../model/dashboardSearch';
import { strings } from '../strings';

/** The opening paper balance every account starts with: ₹10,00,000. */
const OPENING_CASH = 10_00_000_00;

export type HomeFeed = NonNullable<DashboardSearch['feed']>;
const FEEDS = ['watchlist', 'gainers', 'losers'] as const satisfies readonly HomeFeed[];

function HeroFrame({
  label = strings.phone.valueLabel,
  children,
}: {
  label?: string;
  children: ReactNode;
}) {
  // A fixed minimum height, so loading, the figure and an error take the same room (no jump).
  return (
    <section
      aria-labelledby="home-value"
      className="grid min-h-28 content-start justify-items-center gap-1 pt-2 text-center"
    >
      <h1 id="home-value" className="text-body font-normal text-ink-muted">
        {label}
      </h1>
      {children}
    </section>
  );
}

function Value({ paise }: { paise: number }) {
  const shown = useCountedValue(paise);
  return (
    <p className="font-mono text-display leading-tight font-semibold tracking-tight text-ink tabular-nums">
      <DigitRoll value={formatInr(shown)} />
    </p>
  );
}

function LiveValue({ holdings, cash }: { holdings: readonly Holding[]; cash: number }) {
  const { totals } = useLiveHoldings(holdings);
  return (
    <>
      <Value paise={cash + totals.currentValue} />
      <p className="flex items-center gap-1.5 text-body text-ink-muted">
        <PnlAmount value={totals.dayPnl} basisPoints={totals.dayPnlBp} />
        {strings.phone.today}
      </p>
    </>
  );
}

/** Cash plus the live value of the holdings, with the day's P&L; virtual cash when signed out. */
function PortfolioValue() {
  const api = useApiClient();
  const { status, session } = useSession();
  const signedIn = status === 'authenticated' && session !== null;
  const holdings = useQuery({ ...holdingsQuery(api), enabled: signedIn });
  const funds = useQuery({ ...fundsSummaryQuery(api), enabled: signedIn });

  // Only a known signed-out visitor sees the virtual cash; while the session is restored the hero
  // waits in its skeleton, so a signed-in user never sees someone else's figure first.
  if (status === 'anonymous') {
    return (
      <HeroFrame label={strings.phone.signedOutLabel}>
        <Value paise={OPENING_CASH} />
        <p className="text-body text-ink-muted">{strings.phone.signedOutNote}</p>
      </HeroFrame>
    );
  }
  const retry = () => {
    if (holdings.isError) void holdings.refetch();
    if (funds.isError) void funds.refetch();
  };
  if (holdings.data && funds.data) {
    // A failed refresh keeps the last figures, marked as such (DESIGN.md decision 9).
    const stale = holdings.isError || funds.isError;
    return (
      <HeroFrame>
        <LiveValue holdings={holdings.data.items} cash={funds.data.balance} />
        {stale ? (
          <p className="flex items-center gap-2 text-label text-ink-muted">
            <span role="status">{strings.phone.stale}</span>
            <button type="button" onClick={retry} className="min-h-11 font-medium text-brand">
              {strings.sectionError.retry}
            </button>
          </p>
        ) : null}
      </HeroFrame>
    );
  }
  if (holdings.isError || funds.isError) {
    return (
      <HeroFrame>
        {/* One line and a small button, not the full ErrorState: the hero keeps its height. */}
        <p role="alert" className="text-body text-ink">
          {strings.phone.valueError}
        </p>
        <Button size="sm" variant="secondary" onClick={retry}>
          {strings.sectionError.retry}
        </Button>
      </HeroFrame>
    );
  }
  return (
    <HeroFrame>
      <span role="status" className="sr-only">
        {strings.phone.valueLoading}
      </span>
      <span aria-hidden="true" className="mt-1 h-10 w-56 animate-pulse rounded-md bg-surface" />
      <span aria-hidden="true" className="h-5 w-40 animate-pulse rounded-sm bg-surface" />
    </HeroFrame>
  );
}

export type PhoneHomeProps = {
  chart: ReactNode;
  indices: ReactNode;
  lists: ReactNode;
  moversIndex: string | undefined;
  onMoversIndexChange: (index: string) => void;
  feed: HomeFeed;
  onFeedChange: (feed: HomeFeed) => void;
};

/**
 * Home on a phone (NSTOCK-0466), laid out like a native trading app: the portfolio value with the
 * day's P&L, the NIFTY 50 chart with its range chips, Add funds and Place order side by side, then
 * Watchlist, Gainers and Losers as list rows (movers of any of the indices), the indices and the
 * curated lists. Place order opens the trade sheet, the same as the tab bar's centre button.
 */
export function PhoneHome({
  chart,
  indices,
  lists,
  feed,
  onFeedChange,
  moversIndex,
  onMoversIndexChange,
}: PhoneHomeProps) {
  const requestSearch = useSearchFocusStore((s) => s.requestSearch);
  const { status } = useSession();
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      <PortfolioValue />
      {chart}
      <div className="grid grid-cols-2 gap-3">
        {status === 'anonymous' ? (
          <Link to="/login" className={buttonVariants({ variant: 'secondary', size: 'lg' })}>
            {strings.phone.logIn}
          </Link>
        ) : (
          <Link to="/funds" className={buttonVariants({ variant: 'secondary', size: 'lg' })}>
            <IconPlus size={18} />
            {strings.phone.addFunds}
          </Link>
        )}
        <Button size="lg" onClick={requestSearch}>
          <IconTrade size={18} />
          {strings.phone.placeOrder}
        </Button>
      </div>
      <section
        aria-label={strings.phone.feedSection}
        className="rounded-lg border border-line bg-surface px-4 pt-1 pb-2"
      >
        <Tabs
          value={feed}
          onValueChange={(value) => {
            const next = FEEDS.find((f) => f === value);
            if (next) onFeedChange(next);
          }}
        >
          <TabsList aria-label={strings.phone.feedLabel}>
            {FEEDS.map((value) => (
              <TabsTrigger key={value} value={value}>
                {strings.phone.feeds[value]}
              </TabsTrigger>
            ))}
          </TabsList>
          <TabsContent value="watchlist" className="pt-0">
            <WatchlistSection bare onAddStock={requestSearch} />
          </TabsContent>
          {(['gainers', 'losers'] as const satisfies readonly MoverDirection[]).map((direction) => (
            <TabsContent key={direction} value={direction} className="pt-1">
              <div className="flex justify-end py-2">
                <MoversIndexPicker index={moversIndex} onIndexChange={onMoversIndexChange} />
              </div>
              <MoversList index={moversIndex} direction={direction} />
            </TabsContent>
          ))}
        </Tabs>
      </section>
      {indices}
      {lists}
    </div>
  );
}
