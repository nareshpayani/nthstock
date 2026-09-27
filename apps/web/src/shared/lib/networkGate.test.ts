import type { WsClient } from '@nthstock/apiClient';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { gateFetch, gateWsClient } from './networkGate';
import { createSessionApiClient } from './sessionClient';

/** A promise and its settle functions, to open the gate at a chosen moment. */
function deferred() {
  let resolve: () => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Lets every queued promise callback run. */
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const okResponse = () =>
  new Response('{"status":"ok","version":"test","time":"2026-09-27T09:15:00.000Z"}', {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

function fakeWsClient() {
  const released: string[] = [];
  const mocks = {
    subscribe: vi.fn<(symbol: string, exchange?: string) => () => void>((symbol) => () => {
      released.push(symbol);
    }),
    connect: vi.fn(),
    onQuotes: vi.fn(() => () => undefined),
    onMessage: vi.fn(() => () => undefined),
    onStatus: vi.fn(() => () => undefined),
    status: vi.fn(() => 'idle'),
    subscriptionCount: vi.fn(() => 0),
    close: vi.fn(),
  } satisfies Record<keyof WsClient, unknown>;
  // The fakes cover every method; their loose signatures are all this test needs.
  return { client: mocks as unknown as WsClient, mocks, released };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('gateFetch (T-169)', () => {
  it('holds every request until the gate opens, then sends it', async () => {
    const gate = deferred();
    const fetchImpl = vi.fn(() => Promise.resolve(okResponse()));
    const response = gateFetch(gate.promise, fetchImpl)('/v1/health', { method: 'GET' });
    await flush();
    expect(fetchImpl).not.toHaveBeenCalled();
    gate.resolve();
    expect((await response).status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledWith('/v1/health', { method: 'GET' });
  });

  it('opens on a failed start too, so requests fail normally instead of hanging', async () => {
    const gate = deferred();
    const fetchImpl = vi.fn(() => Promise.resolve(okResponse()));
    const response = gateFetch(gate.promise, fetchImpl)('/v1/health', {});
    gate.reject(new Error('no service worker'));
    await response;
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('uses the global fetch by default', async () => {
    const globalFetch = vi.fn(() => Promise.resolve(okResponse()));
    vi.stubGlobal('fetch', globalFetch);
    await gateFetch(Promise.resolve())('/v1/health', {});
    expect(globalFetch).toHaveBeenCalledTimes(1);
  });
});

describe('createSessionApiClient with a readiness promise (T-169)', () => {
  it('sends no request before the promise settles', async () => {
    const gate = deferred();
    const fetchImpl = vi.fn(() => Promise.resolve(okResponse()));
    const apiClient = createSessionApiClient({ fetch: fetchImpl, ready: gate.promise });
    const health = apiClient.request('health');
    await flush();
    expect(fetchImpl).not.toHaveBeenCalled();
    gate.resolve();
    await health;
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('sends at once without one (api mode)', async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(okResponse()));
    const apiClient = createSessionApiClient({ fetch: fetchImpl });
    const health = apiClient.request('health');
    await Promise.resolve();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await health;
  });
});

describe('gateWsClient (T-169)', () => {
  it('replays subscriptions and connect once the gate opens, and not before', async () => {
    const gate = deferred();
    const { client, mocks } = fakeWsClient();
    const gated = gateWsClient(client, gate.promise);
    gated.subscribe('INFY', 'NSE');
    gated.subscribe('TCS');
    gated.connect();
    await flush();
    expect(mocks.subscribe).not.toHaveBeenCalled();
    expect(mocks.connect).not.toHaveBeenCalled();
    gate.resolve();
    await flush();
    expect(mocks.subscribe.mock.calls).toEqual([
      ['INFY', 'NSE'],
      ['TCS', undefined],
    ]);
    expect(mocks.connect).toHaveBeenCalledTimes(1);
  });

  it('drops a subscription released before the gate opens', async () => {
    const gate = deferred();
    const { client, mocks } = fakeWsClient();
    const gated = gateWsClient(client, gate.promise);
    const release = gated.subscribe('INFY', 'NSE');
    release();
    release();
    gate.resolve();
    await flush();
    expect(mocks.subscribe).not.toHaveBeenCalled();
    expect(mocks.connect).not.toHaveBeenCalled();
  });

  it('releases a replayed subscription through the real client, once', async () => {
    const gate = deferred();
    const { client, released } = fakeWsClient();
    const release = gateWsClient(client, gate.promise).subscribe('INFY', 'NSE');
    gate.resolve();
    await flush();
    release();
    release();
    expect(released).toEqual(['INFY']);
  });

  it('passes straight through once open, including after a failed start', async () => {
    const gate = deferred();
    const { client, mocks, released } = fakeWsClient();
    const gated = gateWsClient(client, gate.promise);
    gate.reject(new Error('no service worker'));
    await flush();
    const release = gated.subscribe('INFY', 'BSE');
    gated.connect();
    expect(mocks.subscribe).toHaveBeenCalledWith('INFY', 'BSE');
    expect(mocks.connect).toHaveBeenCalledTimes(1);
    release();
    expect(released).toEqual(['INFY']);
    gated.close();
    expect(mocks.close).toHaveBeenCalledTimes(1);
  });
});
