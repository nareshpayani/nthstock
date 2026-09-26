import { createQuoteStore, createWsClient } from '@nthstock/apiClient';
import { resolveWsUrl, type RuntimeConfig } from './runtimeConfig';

/**
 * The app's live-price pipeline: one WebSocket client (MSW-intercepted in msw mode, apps/realtime
 * in api mode) feeding one quote store. The socket opens on the first subscribed price cell.
 */
export function createLiveQuotes(
  config: Pick<RuntimeConfig, 'wsUrl'>,
  location: { protocol: string; host: string },
) {
  const wsClient = createWsClient({ url: resolveWsUrl(config, location) });
  const quoteStore = createQuoteStore({ source: wsClient });
  return { wsClient, quoteStore };
}
