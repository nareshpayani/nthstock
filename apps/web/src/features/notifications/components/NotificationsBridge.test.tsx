import type { ApiClient } from '@nthstock/apiClient';
import type { Notification, NotificationsResponse, WsNotification } from '@nthstock/contracts';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OrderUpdateSource } from '@/shared/lib/orderUpdatesContext';
import { renderWithProviders } from '@/test/renderWithProviders';
import { resetSession, signIn } from '@/test/session';
import { NotificationBell } from './NotificationBell';
import { NotificationsBridge } from './NotificationsBridge';

const TITLE = 'INFY crossed above ₹1,530.00';

const fired: Notification = {
  id: 'ntf_fired',
  kind: 'PRICE_ALERT',
  title: TITLE,
  body: 'Now ₹1,531.20',
  symbol: 'INFY',
  exchange: 'NSE',
  at: '2026-10-25T04:00:00.000Z',
  read: false,
};

/** A socket stand-in: `push` delivers a `notification` message, `reconnect` a reopen after a drop. */
function fakeSource() {
  const notificationListeners = new Set<(message: WsNotification) => void>();
  const reconnectListeners = new Set<() => void>();
  const source: OrderUpdateSource = {
    onOrderUpdate: () => () => undefined,
    connect: () => undefined,
    onNotification: (listener) => {
      notificationListeners.add(listener);
      return () => notificationListeners.delete(listener);
    },
    onReconnect: (listener) => {
      reconnectListeners.add(listener);
      return () => reconnectListeners.delete(listener);
    },
  };
  return {
    source,
    push: (notification: Notification) =>
      act(() => {
        for (const listener of notificationListeners) {
          listener({ v: 1, type: 'notification', notification });
        }
      }),
    reconnect: () =>
      act(() => {
        for (const listener of reconnectListeners) listener();
      }),
  };
}

/** An API client that answers the notification routes from `server` and counts list reads. */
function fakeApi(server: NotificationsResponse) {
  const lists = vi.fn();
  const api = {
    request: (name: string) => {
      if (name === 'notificationsList') {
        lists();
        return Promise.resolve(structuredClone(server));
      }
      if (name === 'notificationsMarkRead') {
        return Promise.resolve({
          items: server.items.map((item) => ({ ...item, read: true })),
          unread: 0,
        });
      }
      return Promise.reject(new TypeError('offline'));
    },
    url: () => 'http://offline.test',
  } as unknown as ApiClient;
  return { api, lists };
}

const renderBell = (api: ApiClient, source: OrderUpdateSource) =>
  renderWithProviders(
    <>
      <NotificationBell />
      <NotificationsBridge />
    </>,
    { apiClient: api, orderUpdates: source },
  );

beforeEach(() => {
  signIn();
});

afterEach(() => {
  vi.useRealTimers();
  resetSession();
});

describe('NotificationsBridge (NSTOCK-0384)', () => {
  it('shows a notification delivered twice once in the bell and toasts it once', async () => {
    const server: NotificationsResponse = { items: [], unread: 0 };
    const { api, lists } = fakeApi(server);
    const socket = fakeSource();
    const { queryClient } = renderBell(api, socket.source);
    await waitFor(() => expect(lists).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(queryClient.getQueryData(['notifications', 'list'])).toBeDefined());

    server.items = [fired];
    server.unread = 1;
    socket.push(fired);
    socket.push(fired);

    const bell = await screen.findByRole('button', { name: /1 unread/i });
    expect(screen.getAllByText(TITLE)).toHaveLength(1); // the one toast
    expect(screen.getByTestId('notification-badge')).toHaveTextContent('1');
    expect(lists).toHaveBeenCalledTimes(1); // pushed into the cache, not re-read

    fireEvent.click(bell);
    const centre = await screen.findByRole('dialog');
    expect(within(centre).getAllByText(TITLE)).toHaveLength(1);
  });

  it('does not toast a pushed notification the centre already lists', async () => {
    const { api, lists } = fakeApi({ items: [fired], unread: 1 });
    const socket = fakeSource();
    const { queryClient } = renderBell(api, socket.source);
    await waitFor(() => expect(queryClient.getQueryData(['notifications', 'list'])).toBeDefined());
    socket.push(fired);
    expect(screen.queryByText(TITLE)).not.toBeInTheDocument();
    expect(lists).toHaveBeenCalledTimes(1);
  });

  it('reads the list on no timer, and once after the socket reconnects', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const { api, lists } = fakeApi({ items: [], unread: 0 });
    const socket = fakeSource();
    renderBell(api, socket.source);
    await waitFor(() => expect(lists).toHaveBeenCalledTimes(1));

    act(() => {
      vi.advanceTimersByTime(10 * 60_000);
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(lists).toHaveBeenCalledTimes(1);

    socket.reconnect();
    await waitFor(() => expect(lists).toHaveBeenCalledTimes(2));
  });

  it('pings a ripple from the badge while something is unread (NSTOCK-0462)', async () => {
    const { api } = fakeApi({ items: [fired], unread: 1 });
    renderBell(api, fakeSource().source);
    const badge = await screen.findByTestId('notification-badge');
    expect(badge).toHaveTextContent('1');
    const ripple = badge.querySelector('[data-part="ripple"]');
    expect(ripple).not.toBeNull();
    expect(ripple).toHaveClass('animate-ripple');
    // Reduced motion turns the ring off (acceptance criterion of NSTOCK-0462).
    expect(ripple).toHaveClass('motion-reduce:hidden');
  });

  it('shows no badge or ripple when nothing is unread (NSTOCK-0462)', async () => {
    const { api, lists } = fakeApi({ items: [], unread: 0 });
    const { container } = renderBell(api, fakeSource().source);
    await waitFor(() => expect(lists).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole('button', { name: /notifications/i })).toBeInTheDocument();
    expect(screen.queryByTestId('notification-badge')).not.toBeInTheDocument();
    expect(container.querySelector('[data-part="ripple"]')).toBeNull();
  });
});
