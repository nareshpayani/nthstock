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
    expect(start).toHaveBeenCalledWith({ onUnhandledFrame: 'bypass', quiet: true });
    expect(info).toHaveBeenCalledWith(
      expect.stringMatching(/^\[MSW\] Mocking enabled .*forced open/),
    );
    // 52 REST routes (health and ready, 12 market, 7 auth, 8 watchlists, 6 orders, 4 trailing
    // stops, account state, 3 funds, 4 portfolio, 5 alerts and notifications) plus the quote
    // stream, and no test controls.
    expect(setupWorker.mock.calls[0]).toHaveLength(64);
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
    expect(registered).toHaveLength(66);
    expect(registered.slice(0, 2)).toEqual(['*/v1/__test/clock', '*/v1/__test/price']);
    expect(info).toHaveBeenCalledWith(expect.stringContaining('Test controls on'));
    orders.dispose();
    adapter.dispose();
    info.mockRestore();
  });

  it('loads the demo seed on ?demo=1 and drops the parameter (T-174)', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    window.sessionStorage.clear();
    window.history.replaceState(null, '', '/dashboard?demo=1');
    const { startMockWorker } = await import('./browser');
    const { WATCHLIST_MOCK_STORAGE_KEY } = await import('./handlers');
    const { adapter, orders } = await startMockWorker({
      apiMode: 'msw',
      apiBaseUrl: '',
      wsUrl: null,
      mockMarketOpen: false,
      testControls: false,
    });
    expect(window.location.pathname + window.location.search).toBe('/dashboard');
    expect(window.sessionStorage.getItem(WATCHLIST_MOCK_STORAGE_KEY)).toContain('usr_demo');
    expect(info).toHaveBeenCalledWith(expect.stringContaining('Demo seed loaded'));
    orders.dispose();
    adapter.dispose();
    window.sessionStorage.clear();
    window.history.replaceState(null, '', '/');
    info.mockRestore();
  });

  it('loads the demo seed when main.tsx already read and dropped ?demo=1 (T-169)', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    window.sessionStorage.clear();
    window.history.replaceState(null, '', '/dashboard');
    const { startMockWorker } = await import('./browser');
    const { WATCHLIST_MOCK_STORAGE_KEY } = await import('./handlers');
    const { adapter, orders } = await startMockWorker(
      { apiMode: 'msw', apiBaseUrl: '', wsUrl: null, mockMarketOpen: false, testControls: false },
      undefined,
      { demo: true },
    );
    expect(window.location.pathname + window.location.search).toBe('/dashboard');
    expect(window.sessionStorage.getItem(WATCHLIST_MOCK_STORAGE_KEY)).toContain('usr_demo');
    orders.dispose();
    adapter.dispose();
    window.sessionStorage.clear();
    window.history.replaceState(null, '', '/');
    info.mockRestore();
  });

  it('skips the demo seed when told so, even with ?demo=1 in the URL', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    window.sessionStorage.clear();
    window.history.replaceState(null, '', '/dashboard?demo=1');
    const { startMockWorker } = await import('./browser');
    const { WATCHLIST_MOCK_STORAGE_KEY } = await import('./handlers');
    const { adapter, orders } = await startMockWorker(
      { apiMode: 'msw', apiBaseUrl: '', wsUrl: null, mockMarketOpen: false, testControls: false },
      undefined,
      { demo: false },
    );
    expect(window.sessionStorage.getItem(WATCHLIST_MOCK_STORAGE_KEY)).toBeNull();
    orders.dispose();
    adapter.dispose();
    window.history.replaceState(null, '', '/');
    info.mockRestore();
  });
});

describe('Try demo starter (TFC-12)', () => {
  const config = {
    apiMode: 'msw',
    apiBaseUrl: '',
    wsUrl: null,
    mockMarketOpen: false,
    testControls: false,
  } as const;

  it('outside demo mode, reloads with ?demo=1 and marks Try demo pending', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    window.sessionStorage.clear();
    window.history.replaceState(null, '', '/login');
    const { startMockWorker } = await import('./browser');
    const { DEMO_PENDING_STORAGE_KEY, setDemoStarter, startDemo } =
      await import('@/shared/lib/demoSimulator');
    const navigate = vi.fn();
    const { adapter, orders } = await startMockWorker(config, undefined, { navigate });

    expect(startDemo()).toBe('reloading');
    expect(navigate).toHaveBeenCalledWith('/login?demo=1');
    expect(window.sessionStorage.getItem(DEMO_PENDING_STORAGE_KEY)).toBe('1');
    setDemoStarter(null);
    orders.dispose();
    adapter.dispose();
    window.sessionStorage.clear();
    info.mockRestore();
  });

  it('in demo mode, is ready and registers the Simulator once', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    window.sessionStorage.clear();
    window.history.replaceState(null, '', '/login');
    const demo = await import('@/shared/lib/demoSimulator');
    const register = vi.spyOn(demo, 'registerSimulator');
    const { startMockWorker } = await import('./browser');
    const navigate = vi.fn();
    const { adapter, orders } = await startMockWorker(config, undefined, { demo: true, navigate });
    const registeredAtStart = register.mock.calls.length;

    expect(demo.startDemo()).toBe('ready');
    expect(demo.startDemo()).toBe('ready');
    expect(navigate).not.toHaveBeenCalled();
    expect(registeredAtStart).toBe(1);
    expect(register).toHaveBeenCalledTimes(1);
    demo.setDemoStarter(null);
    demo.registerSimulator(null);
    register.mockRestore();
    orders.dispose();
    adapter.dispose();
    window.sessionStorage.clear();
    info.mockRestore();
  });

  it('keeps the pending flag on the ?demo=1 load and drops a stale one on any other', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    window.history.replaceState(null, '', '/login');
    const { startMockWorker } = await import('./browser');
    const { DEMO_PENDING_STORAGE_KEY, setDemoStarter } = await import('@/shared/lib/demoSimulator');

    window.sessionStorage.clear();
    window.sessionStorage.setItem(DEMO_PENDING_STORAGE_KEY, '1');
    const demoLoad = await startMockWorker(config, undefined, { demo: true });
    expect(window.sessionStorage.getItem(DEMO_PENDING_STORAGE_KEY)).toBe('1');
    demoLoad.orders.dispose();
    demoLoad.adapter.dispose();

    window.sessionStorage.clear();
    window.sessionStorage.setItem(DEMO_PENDING_STORAGE_KEY, '1');
    const plainLoad = await startMockWorker(config, undefined, { demo: false });
    expect(window.sessionStorage.getItem(DEMO_PENDING_STORAGE_KEY)).toBeNull();
    plainLoad.orders.dispose();
    plainLoad.adapter.dispose();

    setDemoStarter(null);
    window.sessionStorage.clear();
    info.mockRestore();
  });
});
