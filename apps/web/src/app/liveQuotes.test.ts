import { describe, expect, it, vi } from 'vitest';
import { createLiveQuotes } from './liveQuotes';

describe('createLiveQuotes', () => {
  it('connects the WS client lazily to the resolved URL and feeds the quote store', () => {
    const urls: string[] = [];
    class FakeSocket {
      readyState = 0;
      onopen = null;
      onmessage = null;
      onclose = null;
      onerror = null;
      constructor(url: string) {
        urls.push(url);
      }
      send() {}
      close() {}
    }
    vi.stubGlobal('WebSocket', FakeSocket);
    const { wsClient, quoteStore } = createLiveQuotes(
      { wsUrl: null },
      { protocol: 'https:', host: 'nthstock.test' },
    );
    expect(urls).toEqual([]);
    const stop = quoteStore.subscribe('NIFTY50', 'NSE', () => undefined);
    expect(urls).toEqual(['wss://nthstock.test/ws']);
    expect(wsClient.subscriptionCount()).toBe(1);
    stop();
    wsClient.close();
    vi.unstubAllGlobals();
  });
});
