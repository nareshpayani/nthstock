import { afterEach, describe, expect, it, vi } from 'vitest';

const start = vi.fn(() => Promise.resolve(undefined));
const setupWorker = vi.fn((...handlers: unknown[]) => ({ start, handlers }));
vi.mock('msw/browser', () => ({ setupWorker }));

/** The path each HTTP handler matches (the WebSocket handler has none). */
const paths = (handlers: unknown[] = []) =>
  handlers.map((handler) => String((handler as { info?: { path?: unknown } }).info?.path));

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
      testControls: false,
    });
    expect(start).toHaveBeenCalledWith({ onUnhandledRequest: 'bypass', quiet: true });
    expect(info).toHaveBeenCalledWith(
      expect.stringMatching(/^\[MSW\] Mocking enabled .*forced open/),
    );
    // 40 REST routes (health, 12 market, 7 auth, 8 watchlists, 6 orders, 3 funds, 3 portfolio)
    // plus the quote stream, and no test controls.
    expect(setupWorker.mock.calls[0]).toHaveLength(41);
    expect(paths(setupWorker.mock.calls[0])).not.toContainEqual(expect.stringContaining('__test'));
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
      testControls: false,
    });
    expect(info).toHaveBeenCalledWith(
      expect.stringContaining('ws://rt.test/ws, mock market on NSE hours'),
    );
    orders.dispose();
    adapter.dispose();
    info.mockRestore();
  });

  it('puts the test controls first in an E2E build (VITE_TEST_CONTROLS, T-162)', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const { startMockWorker } = await import('./browser');
    const { createTestControls } = await import('./testControls');
    const { adapter, orders } = await startMockWorker(
      { apiMode: 'msw', apiBaseUrl: '', wsUrl: null, mockMarketOpen: false, testControls: true },
      createTestControls(),
    );
    const registered = paths(setupWorker.mock.calls[0]);
    expect(registered).toHaveLength(43);
    expect(registered.slice(0, 2)).toEqual(['*/v1/__test/clock', '*/v1/__test/price']);
    expect(info).toHaveBeenCalledWith(expect.stringContaining('Test controls on'));
    orders.dispose();
    adapter.dispose();
    info.mockRestore();
  });
});
