import type { ApiClient, QuoteStore, WsClient, WsStatus } from '@nthstock/apiClient';
import { BATCH_QUOTES_MAX, type Exchange, type Quote } from '@nthstock/contracts';

/** Latest quotes for up to `BATCH_QUOTES_MAX` symbols on one exchange. */
export type SnapshotFetcher = (symbols: string[], exchange: Exchange) => Promise<readonly Quote[]>;

/** The REST snapshot: `GET /v1/market/quotes` (MSW in msw mode, apps/api in api mode). */
export function restSnapshot(api: Pick<ApiClient, 'request'>): SnapshotFetcher {
  return async (symbols, exchange) => {
    const response = await api.request('marketQuotes', {
      query: { symbols: symbols.join(','), exchange },
    });
    return response.items;
  };
}

export type VisibilityDocument = {
  readonly visibilityState: DocumentVisibilityState;
  addEventListener(type: 'visibilitychange', listener: () => void): void;
  removeEventListener(type: 'visibilitychange', listener: () => void): void;
};

export type VisibilitySyncOptions = {
  document: VisibilityDocument;
  quoteStore: Pick<QuoteStore, 'pause' | 'resume' | 'activeSymbols' | 'ingest'>;
  wsClient: Pick<WsClient, 'onStatus' | 'status'>;
  fetchSnapshot: SnapshotFetcher;
};

/**
 * Background-tab behaviour for live prices (T-077). When the tab is hidden, only pinned symbols
 * (the active watchlist) stay subscribed; the rest are unsubscribed to save the user's data and
 * the server's fan-out. When the tab is visible again, or the socket reconnects after a drop,
 * every watched symbol is resubscribed and its price is resynced from a REST snapshot, so cells
 * do not show stale prices until their next tick. Returns the stop function.
 */
export function startVisibilitySync(options: VisibilitySyncOptions): () => void {
  const { document, quoteStore, wsClient, fetchSnapshot } = options;

  const resync = async () => {
    const byExchange = new Map<Exchange, string[]>();
    for (const key of quoteStore.activeSymbols()) {
      const at = key.indexOf(':');
      const exchange = key.slice(0, at) as Exchange;
      const list = byExchange.get(exchange) ?? [];
      list.push(key.slice(at + 1));
      byExchange.set(exchange, list);
    }
    const requests: Promise<void>[] = [];
    for (const [exchange, symbols] of byExchange) {
      for (let i = 0; i < symbols.length; i += BATCH_QUOTES_MAX) {
        requests.push(
          fetchSnapshot(symbols.slice(i, i + BATCH_QUOTES_MAX), exchange).then(
            (quotes) => quoteStore.ingest(quotes),
            () => undefined, // The next tick brings the price anyway; a failed snapshot is not fatal.
          ),
        );
      }
    }
    await Promise.all(requests);
  };

  const onVisibility = () => {
    if (document.visibilityState === 'hidden') {
      quoteStore.pause();
      return;
    }
    quoteStore.resume();
    void resync();
  };

  let lastStatus: WsStatus = wsClient.status();
  const stopStatus = wsClient.onStatus((status) => {
    if (status === 'open' && lastStatus === 'reconnecting') void resync();
    lastStatus = status;
  });

  document.addEventListener('visibilitychange', onVisibility);
  if (document.visibilityState === 'hidden') quoteStore.pause();

  return () => {
    document.removeEventListener('visibilitychange', onVisibility);
    stopStatus();
  };
}
