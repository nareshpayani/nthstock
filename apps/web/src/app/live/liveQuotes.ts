import { createQuoteStore, createWsClient } from '@nthstock/apiClient';
import { gateWsClient } from '@/shared/lib/networkGate';
import type { OrderUpdateSource } from '@/shared/lib/orderUpdatesContext';
import { resolveWsUrl, type RuntimeConfig } from '../config/runtimeConfig';

/**
 * The app's live-price pipeline: one WebSocket client (MSW-intercepted in msw mode, apps/realtime
 * in api mode) feeding one quote store. The socket opens on the first subscribed price cell, or
 * when the order-update listener asks for it. The same socket carries the signed-in user's
 * `orderUpdate` messages (T-147).
 */
export function createLiveQuotes(
  config: Pick<RuntimeConfig, 'wsUrl'>,
  location: { protocol: string; host: string },
  /** msw mode (T-169): the socket opens only once this, the MSW worker's start, settles. */
  ready?: Promise<unknown>,
) {
  const client = createWsClient({ url: resolveWsUrl(config, location) });
  const wsClient = ready ? gateWsClient(client, ready) : client;
  const quoteStore = createQuoteStore({ source: wsClient });
  const orderUpdates: OrderUpdateSource = {
    onOrderUpdate: (listener) =>
      wsClient.onMessage((message) => {
        if (message.type === 'orderUpdate') listener(message.order);
      }),
    connect: () => {
      wsClient.connect();
    },
  };
  return { wsClient, quoteStore, orderUpdates };
}
