import {
  createQuoteStore,
  createTradingStore,
  createWsClient,
  tradingSourceOf,
  type TradingCommit,
} from '@nthstock/apiClient';
import type { AccountState } from '@nthstock/contracts';
import { gateWsClient } from '@/shared/lib/networkGate';
import type { OrderUpdateSource } from '@/shared/lib/orderUpdatesContext';
import { resolveWsUrl, type RuntimeConfig } from '../config/runtimeConfig';

/**
 * The app's live-price pipeline: one WebSocket client (MSW-intercepted in msw mode, apps/realtime
 * in api mode) feeding one quote store. The socket opens on the first subscribed price cell, or
 * when the order-update listener asks for it. The same socket carries the signed-in user's
 * `orderUpdate` messages (T-147).
 *
 * With `trading` (both modes: the in-browser engine and apps/api both send account frames,
 * NSTOCK-0368), a trading store rides the same
 * socket (ADR 0012): it is started on sign-in, and its frames' quotes reach the quote store first,
 * so both commit on the same animation frame. Order updates then come from the frames' orders.
 */
export function createLiveQuotes(
  config: Pick<RuntimeConfig, 'wsUrl'>,
  location: { protocol: string; host: string },
  /** msw mode (T-169): the socket opens only once this, the MSW worker's start, settles. */
  ready?: Promise<unknown>,
  trading?: {
    loadState: () => Promise<AccountState>;
    onCommit?: (commit: TradingCommit) => void;
  },
) {
  const client = createWsClient({ url: resolveWsUrl(config, location) });
  const wsClient = ready ? gateWsClient(client, ready) : client;
  const quoteStore = createQuoteStore({ source: wsClient });
  const orderUpdates: OrderUpdateSource = {
    onOrderUpdate: (listener) =>
      wsClient.onMessage((message) => {
        if (message.type === 'orderUpdate') listener(message.order);
        if (message.type === 'accountDelta') for (const order of message.orders) listener(order);
      }),
    connect: () => {
      wsClient.connect();
    },
    onNotification: (listener) =>
      wsClient.onMessage((message) => {
        if (message.type === 'notification') listener(message);
      }),
  };
  const tradingStore = trading
    ? createTradingStore({
        source: tradingSourceOf(wsClient),
        quoteStore,
        loadState: trading.loadState,
        ...(trading.onCommit ? { onCommit: trading.onCommit } : {}),
      })
    : undefined;
  return { wsClient, quoteStore, orderUpdates, tradingStore };
}
