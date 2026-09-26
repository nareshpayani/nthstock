import { ErrorState, Tabs, TabsContent, TabsList, TabsTrigger } from '@nthstock/ui';
import { useQuery } from '@tanstack/react-query';
import { Card } from '@/shared/components/Card';
import { SkeletonRows } from '@/shared/components/SkeletonRows';
import { StockRow } from '@/shared/components/StockRow';
import { useApiClient } from '@/shared/lib/apiClientContext';
import { listQuery } from '../api/listQuery';
import { strings } from '../strings';

/** Rows shown per list on the dashboard. */
export const LIST_ROWS = 5;

export type StockListTab = (typeof strings.lists)[number];
export const STOCK_LISTS: readonly StockListTab[] = strings.lists;
export const DEFAULT_LIST_ID: string = strings.lists[0].id;

/** The list id to show for a URL value: known ids pass, anything else falls back to the first. */
export const resolveListId = (id: string | undefined): string =>
  STOCK_LISTS.some((list) => list.id === id) ? (id as string) : DEFAULT_LIST_ID;

function ListRows({ list }: { list: StockListTab }) {
  const api = useApiClient();
  const query = useQuery(listQuery(api, list.id));
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
  if (!query.data) return <SkeletonRows count={LIST_ROWS} label={strings.loading(list.title)} />;
  const rows = query.data.items.slice(0, LIST_ROWS);
  if (rows.length === 0) return <p className="py-6 text-center text-ink-muted">{strings.empty}</p>;
  return (
    <ul>
      {rows.map((row) => (
        <StockRow key={`${row.exchange}:${row.symbol}`} row={row} />
      ))}
    </ul>
  );
}

export type StocksListsCardProps = {
  /** Selected list id (from the URL); unknown ids show the first list. */
  listId: string | undefined;
  onListChange: (id: string) => void;
};

/**
 * Curated stock lists (T-097): a tab per list, each fetched when its tab opens, rows that tick
 * live and open the stock's detail page.
 */
export function StocksListsCard({ listId, onListChange }: StocksListsCardProps) {
  const active = resolveListId(listId);
  return (
    <Card title={strings.title}>
      <Tabs value={active} onValueChange={onListChange}>
        <TabsList aria-label={strings.title}>
          {STOCK_LISTS.map((list) => (
            <TabsTrigger key={list.id} value={list.id}>
              {list.title}
            </TabsTrigger>
          ))}
        </TabsList>
        {STOCK_LISTS.map((list) => (
          <TabsContent key={list.id} value={list.id} className="pt-1">
            <ListRows list={list} />
          </TabsContent>
        ))}
      </Tabs>
    </Card>
  );
}
