import type { ApiClient } from '@nthstock/apiClient';
import { screen, waitFor } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it, onTestFinished, vi } from 'vitest';
import { createMockServer } from '@/mocks/node';
import { renderApp } from '@/test/renderApp';
import { resetSession } from '@/test/session';
import { setDemoStarter } from '@/shared/lib/demoSimulator';
import { createSessionApiClient } from '@/shared/lib/sessionClient';

// The tests land on a stock page; jsdom has no canvas, and a real chart throws after teardown.
vi.mock('lightweight-charts', () => import('@/test/chartsMock'));

// NSTOCK-0444: its own mock server, so the demo account starts with no position here. The mock
// clock is a weekday at 10:00 IST, in market hours, for the auth and orders mocks alike.
const NOW = Date.parse('2026-09-28T04:30:00.000Z');
let now = NOW;
const { server, adapter } = createMockServer({
  auth: { now: () => now },
  orders: { now: () => now, marketHours: 'nse' },
});
const orderPosts: string[] = [];
server.events.on('request:start', ({ request }) => {
  if (request.method === 'POST' && new URL(request.url).pathname === '/v1/orders') {
    orderPosts.push(request.url);
  }
});

beforeAll(() => {
  server.listen({ onUnhandledFrame: 'error' });
});
afterEach(() => {
  resetSession();
  window.localStorage.clear();
  window.sessionStorage.clear();
});
afterAll(() => {
  server.close();
  adapter.dispose();
});

let browsers = 0;
function newBrowser(): ApiClient {
  browsers += 1;
  return createSessionApiClient({ baseUrl: `http://b${String(browsers)}.trylink.test` });
}

describe('the reviewer link, /login?try=1 (NSTOCK-0444)', () => {
  it('signs in without a tap and places the demo position once', async () => {
    setDemoStarter(() => 'ready');
    onTestFinished(() => setDemoStarter(null));
    const apiClient = newBrowser();
    const { router } = renderApp('/login?try=1', { apiClient });

    await waitFor(() => expect(router.state.location.pathname).toBe('/stocks/RELIANCE'));
    expect(orderPosts).toHaveLength(1);
    const { items } = await apiClient.request('positionsList');
    expect(items.find((p) => p.symbol === 'RELIANCE' && p.product === 'INTRADAY')?.netQty).toBe(10);
    await screen.findByRole('heading', { level: 1, name: /Reliance/ });
  });

  it('places nothing on a second run, while the position is still open', async () => {
    setDemoStarter(() => 'ready');
    onTestFinished(() => setDemoStarter(null));
    // Past the 30 s OTP resend throttle for the demo mobile.
    now += 60_000;
    const { router } = renderApp('/login?try=1', { apiClient: newBrowser() });

    await waitFor(() => expect(router.state.location.pathname).toBe('/stocks/RELIANCE'));
    expect(orderPosts).toHaveLength(1);
  });

  it('does not start on any other value of try', async () => {
    renderApp('/login?try=2', { apiClient: newBrowser() });
    await screen.findByRole('heading', { level: 1, name: 'Log in to nthstock' });
    expect(screen.getByRole('button', { name: 'Try demo' })).toBeEnabled();
  });
});
