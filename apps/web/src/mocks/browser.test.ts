import { afterEach, describe, expect, it, vi } from 'vitest';

const start = vi.fn(() => Promise.resolve(undefined));
const setupWorker = vi.fn((...handlers: unknown[]) => ({ start, handlers }));
vi.mock('msw/browser', () => ({ setupWorker }));

afterEach(() => {
  vi.clearAllMocks();
});

describe('startMockWorker (T-050)', () => {
  it('registers REST and WebSocket handlers over one adapter and bypasses assets', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const { startMockWorker } = await import('./browser');
    const { adapter, orders } = await startMockWorker({
      apiMode: 'msw',
      apiBaseUrl: '',
      wsUrl: null,
      mockMarketOpen: true,
    });
    expect(start).toHaveBeenCalledWith({ onUnhandledRequest: 'bypass', quiet: true });
    expect(info).toHaveBeenCalledWith(
      expect.stringMatching(/^\[MSW\] Mocking enabled .*forced open/),
    );
    // 38 REST routes (health, 12 market, 7 auth, 8 watchlists, 7 orders and funds, 3 portfolio)
    // plus the quote stream.
    expect(setupWorker.mock.calls[0]).toHaveLength(39);
    expect(adapter.isOpen()).toBe(true);
    orders.dispose();
    adapter.dispose();
    info.mockRestore();
  });

  it('says when the mock market follows NSE hours', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const { startMockWorker } = await import('./browser');
    const { adapter, orders } = await startMockWorker({
      apiMode: 'msw',
      apiBaseUrl: '',
      wsUrl: 'ws://rt.test/ws',
      mockMarketOpen: false,
    });
    expect(info).toHaveBeenCalledWith(
      expect.stringContaining('ws://rt.test/ws, mock market on NSE hours'),
    );
    orders.dispose();
    adapter.dispose();
    info.mockRestore();
  });
});
