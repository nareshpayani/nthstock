import type { Order } from '@nthstock/contracts';
import {
  EmptyState,
  ErrorState,
  IconClock,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  useToast,
} from '@nthstock/ui';
import { useQuery } from '@tanstack/react-query';
import { useContext, useMemo, useRef, useState } from 'react';
import { PageHeader } from '@/shared/components/PageHeader';
import { SearchStocksButton } from '@/shared/components/SearchStocksButton';
import { useApiClient } from '@/shared/lib/apiClientContext';
import { MarketSessionContext } from '@/shared/lib/marketSessionContext';
import { useTicketIntentStore } from '@/shared/lib/ticketIntentStore';
import { orderBookQuery } from '../api/ordersQuery';
import { useCancelOrder } from '../hooks/useCancelOrder';
import { describeOrderActionError } from '../model/orderActionError';
import { ORDER_TABS, groupOrders, orderName, type OrderTab } from '../model/orderBook';
import { strings } from '../strings';
import { CancelOrderDialog } from './CancelOrderDialog';
import { OrderDetailSheet } from './OrderDetailSheet';
import { OrderTable } from './OrderTable';

/** The order book's URL state (ADR 0005): the tab and the order open in the drawer. */
export type OrdersSearch = { tab?: OrderTab | undefined; order?: string | undefined };

export type OrdersPageProps = {
  search: OrdersSearch;
  onSearchChange: (patch: OrdersSearch) => void;
};

function LoadingRows() {
  return (
    <div role="status" aria-label={strings.loading} className="grid gap-2 p-4">
      {Array.from({ length: 4 }, (_, index) => (
        <div key={index} className="h-10 animate-pulse rounded-md bg-canvas" />
      ))}
    </div>
  );
}

/**
 * The order book (T-144 to T-147): Open (AMO and OPEN), Executed, and Cancelled (with Rejected)
 * tabs with counts, from one list so each count is exactly its rows. Open orders can be modified
 * in the order ticket or cancelled after a confirm (T-145); any row opens the detail drawer with
 * its status timeline (T-146). Live order updates refetch the book (T-147).
 */
export function OrdersPage({ search, onSearchChange }: OrdersPageProps) {
  const api = useApiClient();
  const toast = useToast();
  const { clock } = useContext(MarketSessionContext);
  const openTicket = useTicketIntentStore((s) => s.openTicket);
  const book = useQuery(orderBookQuery(api));
  const cancelOrder = useCancelOrder();
  const [cancelling, setCancelling] = useState<Order | null>(null);
  const detailTrigger = useRef<HTMLElement | null>(null);
  const tab = search.tab ?? 'open';
  const groups = useMemo(() => groupOrders(book.data ?? []), [book.data]);
  const detailOrder = search.order
    ? book.data?.find((order) => order.id === search.order)
    : undefined;
  const now = clock.now();

  const modify = (order: Order) => {
    openTicket({ symbol: order.symbol, exchange: order.exchange, side: order.side, modify: order });
  };

  const confirmCancel = (order: Order) => {
    cancelOrder.mutate(order.id, {
      onSuccess: (cancelled) => {
        setCancelling(null);
        toast.show({
          title: strings.cancelDialog.done,
          description: strings.cancelDialog.doneBody(orderName(cancelled)),
          tone: 'success',
        });
      },
      onError: (error) => {
        setCancelling(null);
        toast.show({
          title: strings.cancelDialog.failed,
          description: describeOrderActionError(error),
          tone: 'error',
        });
      },
    });
  };

  let body;
  if (book.isPending) {
    body = <LoadingRows />;
  } else if (book.isError) {
    body = (
      <ErrorState
        title={strings.loadError.title}
        description={strings.loadError.body}
        retryLabel={strings.loadError.retry}
        onRetry={() => void book.refetch()}
      />
    );
  } else {
    body = (
      <Tabs
        value={tab}
        onValueChange={(next) => onSearchChange({ tab: next as OrderTab })}
        className="grid gap-0"
      >
        <TabsList aria-label={strings.tabsLabel} className="px-4">
          {ORDER_TABS.map((key) => (
            <TabsTrigger key={key} value={key}>
              {strings.tabLabel(strings.tabs[key], groups[key].length)}
            </TabsTrigger>
          ))}
        </TabsList>
        {ORDER_TABS.map((key) => (
          <TabsContent key={key} value={key} className="pt-0">
            {groups[key].length === 0 ? (
              <EmptyState
                title={strings.empty[key].title}
                description={strings.empty[key].body}
                icon={<IconClock size={24} />}
                action={<SearchStocksButton label={strings.emptyCta} />}
              />
            ) : (
              <OrderTable
                orders={groups[key]}
                label={strings.tableLabel(strings.tabs[key])}
                now={now}
                onDetails={(order, trigger) => {
                  detailTrigger.current = trigger;
                  onSearchChange({ order: order.id });
                }}
                onModify={modify}
                onCancel={(order) => setCancelling(order)}
              />
            )}
          </TabsContent>
        ))}
      </Tabs>
    );
  }

  return (
    <div className="mx-auto grid w-full max-w-[1200px] grid-cols-[minmax(0,1fr)] gap-4 lg:gap-6">
      <PageHeader title={strings.title} description={strings.description} />
      <div className="rounded-lg border border-line bg-surface">{body}</div>
      <CancelOrderDialog
        order={cancelling}
        cancelling={cancelOrder.isPending}
        onKeep={() => setCancelling(null)}
        onConfirm={confirmCancel}
      />
      <OrderDetailSheet
        orderId={search.order ?? null}
        initial={detailOrder}
        onClose={() => onSearchChange({ order: undefined })}
        returnFocus={detailTrigger}
      />
    </div>
  );
}
