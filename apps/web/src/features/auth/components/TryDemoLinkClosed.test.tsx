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

// NSTOCK-0444: a weekday at 20:00 IST, so the market is closed and the demo's market buy is not
// filled. Its own mock server, so no earlier run left a position open.
const now = Date.parse('2026-09-28T14:30:00.000Z');
const { server, adapter } = createMockServer({
  auth: { now: () => now },
  orders: { now: () => now, marketHours: 'nse' },
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

describe('the reviewer link with the market closed (NSTOCK-0444)', () => {
  it('still opens the stock page, and says the demo position did not open', async () => {
    setDemoStarter(() => 'ready');
    onTestFinished(() => setDemoStarter(null));
    const apiClient: ApiClient = createSessionApiClient({ baseUrl: 'http://closed.trylink.test' });
    const { router } = renderApp('/login?try=1', { apiClient });

    await waitFor(() => expect(router.state.location.pathname).toBe('/stocks/RELIANCE'));
    expect(await screen.findByText('The demo position did not open')).toBeInTheDocument();
  });
});
