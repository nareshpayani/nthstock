import type { Exchange } from '@nthstock/contracts';
import type { FetchLike, WsClient } from '@nthstock/apiClient';

/**
 * Network gating for msw mode (T-169). main.tsx renders at once and starts the MSW worker beside
 * it; REST calls and the quote socket wait for that one readiness promise, so nothing reaches the
 * network before MSW intercepts it, and nothing that needs no data (shell, header, hero) waits.
 * api mode passes no promise and gets the ungated clients.
 *
 * A failed start opens the gate too: requests then fail as they would without mocks and the
 * sections show their error states, instead of waiting forever.
 */

const settled = (ready: Promise<unknown>): Promise<void> =>
  ready.then(
    () => undefined,
    () => undefined,
  );

/**
 * A fetch that waits for `ready` before every request; the global fetch by default. A function is
 * called (and awaited) before each request instead, so msw mode can re-check its worker each time.
 */
export function gateFetch(
  ready: Promise<unknown> | (() => Promise<unknown>),
  fetchImpl: FetchLike = (input, init) => globalThis.fetch(input, init),
): FetchLike {
  const open = typeof ready === 'function' ? null : settled(ready);
  return async (input, init) => {
    await (open ?? settled(Promise.resolve().then(ready as () => Promise<unknown>)));
    return fetchImpl(input, init);
  };
}

type Pending = { symbol: string; exchange: Exchange | undefined; release: (() => void) | null };

/**
 * The WebSocket client, with `subscribe` and `connect` held until `ready` settles. Subscriptions
 * made meanwhile are replayed in order (one released first is dropped), and the socket opens only
 * then, after MSW has patched `WebSocket`. Every other method goes straight through.
 */
export function gateWsClient(client: WsClient, ready: Promise<unknown>): WsClient {
  let open = false;
  let wantsConnect = false;
  const pending = new Set<Pending>();

  void settled(ready).then(() => {
    open = true;
    for (const entry of pending) {
      entry.release = client.subscribe(entry.symbol, entry.exchange);
    }
    pending.clear();
    if (wantsConnect) client.connect();
  });

  return {
    ...client,
    subscribe(symbol, exchange) {
      if (open) return client.subscribe(symbol, exchange);
      const entry: Pending = { symbol, exchange, release: null };
      pending.add(entry);
      let released = false;
      return () => {
        if (released) return;
        released = true;
        if (entry.release) entry.release();
        else pending.delete(entry);
      };
    },
    connect() {
      if (open) client.connect();
      else wantsConnect = true;
    },
  };
}
