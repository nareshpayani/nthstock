import type { ApiClient } from '@nthstock/apiClient';
import { DEV_OTP, type SearchHit, type Watchlist } from '@nthstock/contracts';
import { createSessionApiClient } from '@/shared/lib/sessionClient';
import { signIn } from './session';

/** Logs `mobile` in on the MSW node server; returns the session-aware client. */
export async function loginOnMock(mobile: string, baseUrl = 'http://watchlists.test') {
  const apiClient = createSessionApiClient({ baseUrl });
  const { requestId } = await apiClient.request('otpRequest', { body: { mobile } });
  signIn(await apiClient.request('otpVerify', { body: { requestId, mobile, otp: DEV_OTP } }));
  return apiClient;
}

/** The search hit for an exact symbol on the mock market. */
export async function findStock(apiClient: ApiClient, symbol: string): Promise<SearchHit> {
  const { items } = await apiClient.request('marketSearch', { query: { q: symbol, limit: 8 } });
  const hit = items.find((item) => item.symbol === symbol);
  if (!hit) throw new Error(`${symbol} not found`);
  return hit;
}

/** Adds `symbols` in order to the user's first list (the default "My Watchlist"). */
export async function seedList(
  apiClient: ApiClient,
  symbols: readonly string[],
): Promise<Watchlist> {
  const { items } = await apiClient.request('watchlistsList');
  const list = items[0];
  if (!list) throw new Error('no default list');
  let latest = list;
  for (const symbol of symbols) {
    const hit = await findStock(apiClient, symbol);
    latest = await apiClient.request('watchlistItemAdd', {
      params: { id: list.id },
      body: { token: hit.token },
    });
  }
  return latest;
}

/**
 * jsdom has no layout: give every element a `height`×320 box so TanStack Virtual can measure its
 * scroll area. Returns the restore function.
 */
export function fakeLayout(height: number): () => void {
  const original = {
    height: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight'),
    width: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth'),
  };
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get: () => height,
  });
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
    configurable: true,
    get: () => 320,
  });
  return () => {
    if (original.height)
      Object.defineProperty(HTMLElement.prototype, 'offsetHeight', original.height);
    if (original.width) Object.defineProperty(HTMLElement.prototype, 'offsetWidth', original.width);
  };
}
