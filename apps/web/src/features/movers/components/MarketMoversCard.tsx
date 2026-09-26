import type { MoverDirection } from '@nthstock/contracts';
import {
  ErrorState,
  SegmentedControl,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@nthstock/ui';
import { useQuery } from '@tanstack/react-query';
import { Card } from '@/shared/components/Card';
import { SkeletonRows } from '@/shared/components/SkeletonRows';
import { StockRow } from '@/shared/components/StockRow';
import { useApiClient } from '@/shared/lib/apiClientContext';
import { moversQuery } from '../api/moversQuery';
import { strings } from '../strings';

/** Rows shown per direction on the dashboard. */
export const MOVERS_ROWS = 5;
export const MOVERS_DIRECTIONS = ['gainers', 'losers'] as const satisfies readonly MoverDirection[];

export type MoversIndex = (typeof strings.indices)[number];
export const MOVERS_INDICES: readonly MoversIndex[] = strings.indices;
export const DEFAULT_MOVERS_INDEX: string = strings.indices[0].value;
export const DEFAULT_MOVERS_DIRECTION: MoverDirection = 'gainers';

/** The index for a URL value: known symbols pass, anything else falls back to the Nifty 50. */
export const resolveMoversIndex = (symbol: string | undefined): MoversIndex =>
  MOVERS_INDICES.find((index) => index.value === symbol) ?? strings.indices[0];

function MoversRows({ index, direction }: { index: MoversIndex; direction: MoverDirection }) {
  const api = useApiClient();
  const query = useQuery(moversQuery(api, { index: index.value, direction, limit: MOVERS_ROWS }));
  if (query.isError) {
    return (
      <ErrorState
        title={strings.errorTitle}
        description={strings.errorBody}
        retryLabel={strings.retry}
        onRetry={() => void query.refetch()}
      />
    );
  }
  if (!query.data) {
    return (
      <SkeletonRows
        count={MOVERS_ROWS}
        label={strings.loading(strings.direction[direction], index.name)}
      />
    );
  }
  if (query.data.items.length === 0) {
    return (
      <p className="py-6 text-center text-ink-muted">{strings.empty(direction, index.name)}</p>
    );
  }
  return (
    <ul>
      {query.data.items.map((row) => (
        <StockRow key={`${row.exchange}:${row.symbol}`} row={row} />
      ))}
    </ul>
  );
}

export type MarketMoversCardProps = {
  /** Index symbol from the URL; unknown values show the Nifty 50. */
  index: string | undefined;
  direction: MoverDirection;
  onIndexChange: (index: string) => void;
  onDirectionChange: (direction: MoverDirection) => void;
};

/**
 * Market movers (T-098): top gainers or losers among an index's constituents. Changing the index
 * or the direction fetches that ranking; rows tick live and open stock detail.
 */
export function MarketMoversCard({
  index,
  direction,
  onIndexChange,
  onDirectionChange,
}: MarketMoversCardProps) {
  const active = resolveMoversIndex(index);
  return (
    <Card
      title={strings.title}
      aside={
        <SegmentedControl
          label={strings.indexLabel}
          size="sm"
          value={active.value}
          onValueChange={onIndexChange}
          options={MOVERS_INDICES.map(({ value, label }) => ({ value, label }))}
        />
      }
    >
      <Tabs
        value={direction}
        onValueChange={(value) => {
          const next = MOVERS_DIRECTIONS.find((d) => d === value);
          if (next) onDirectionChange(next);
        }}
      >
        <TabsList aria-label={strings.directionLabel}>
          {MOVERS_DIRECTIONS.map((value) => (
            <TabsTrigger key={value} value={value}>
              {strings.direction[value]}
            </TabsTrigger>
          ))}
        </TabsList>
        {MOVERS_DIRECTIONS.map((value) => (
          <TabsContent key={value} value={value} className="pt-1">
            <MoversRows index={active} direction={value} />
          </TabsContent>
        ))}
      </Tabs>
    </Card>
  );
}
