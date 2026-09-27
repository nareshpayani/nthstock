import { createQuoteStore, createWsClient, type WebSocketLike } from '@nthstock/apiClient';
import type { WatchlistItem, WsClientMessage } from '@nthstock/contracts';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/test/renderWithProviders';
import { fakeLayout } from '@/test/watchlists';
import { ROW_HEIGHT } from './WatchlistRow';
import { VISIBLE_ROWS, WatchlistRows } from './WatchlistRows';

/** A WebSocket stand-in that records every frame the client sends. */
class RecordingSocket implements WebSocketLike {
  static last: RecordingSocket | null = null;
  readyState = 0;
  binaryType = 'blob';
  readonly sent: WsClientMessage[] = [];
  onopen: ((event: unknown) => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: unknown) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  constructor() {
    RecordingSocket.last = this;
    queueMicrotask(() => {
      this.readyState = 1;
      this.onopen?.({});
    });
  }
  send(data: string) {
    this.sent.push(JSON.parse(data) as WsClientMessage);
  }
  close() {
    this.readyState = 3;
  }
}

const items: WatchlistItem[] = Array.from({ length: 30 }, (_, index) => ({
  token: 5000 + index,
  symbol: `STOCK${String(index)}`,
  exchange: 'NSE',
  name: `Stock ${String(index)}`,
  addedAt: '2026-09-25T04:00:00.000Z',
}));

const framesOf = (type: 'subscribe' | 'unsubscribe') =>
  (RecordingSocket.last?.sent ?? [])
    .filter((frame) => frame.type === type)
    .flatMap((frame) => ('symbols' in frame ? frame.symbols : []));

let restoreLayout: () => void = () => undefined;
beforeAll(() => {
  restoreLayout = fakeLayout(VISIBLE_ROWS * ROW_HEIGHT);
});
afterAll(() => restoreLayout());

describe('WatchlistRows live subscriptions (T-124)', () => {
  it('subscribes only mounted rows and unsubscribes a row scrolled out of view', async () => {
    const wsClient = createWsClient({ url: 'ws://rows.test/ws', WebSocket: RecordingSocket });
    const quoteStore = createQuoteStore({ source: wsClient, schedule: (flush) => flush() });
    renderWithProviders(
      <WatchlistRows
        label="Stocks in Big list"
        items={items}
        snapshot={new Map()}
        reorderable
        onReorder={vi.fn()}
        onReorderBlocked={vi.fn()}
        onTrade={vi.fn()}
        onRemove={vi.fn()}
      />,
      { quoteStore },
    );

    const list = await screen.findByRole('list', { name: 'Stocks in Big list' });
    const mounted = within(list).getAllByRole('listitem');
    // 8 rows in view plus a small overscan, out of 30.
    expect(mounted.length).toBeGreaterThanOrEqual(VISIBLE_ROWS);
    expect(mounted.length).toBeLessThan(15);
    await waitFor(() => expect(framesOf('subscribe')).toContain('STOCK0'));
    expect(framesOf('subscribe')).not.toContain('STOCK29');
    expect(wsClient.subscriptionCount()).toBe(mounted.length);

    // Scroll to the bottom: the first rows unmount and their symbols are unsubscribed.
    const scroller = list.parentElement as HTMLElement;
    scroller.scrollTop = items.length * ROW_HEIGHT;
    fireEvent.scroll(scroller);

    await waitFor(() => expect(within(list).queryByText('STOCK0')).toBeNull());
    await waitFor(() => expect(framesOf('unsubscribe')).toContain('STOCK0'));
    await waitFor(() => expect(framesOf('subscribe')).toContain('STOCK29'));
    expect(wsClient.subscriptionCount()).toBe(within(list).getAllByRole('listitem').length);
    wsClient.close();
    quoteStore.dispose();
  });
});
