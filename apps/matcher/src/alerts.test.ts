import { NOTIFICATION_EVENT_VERSION, type NotificationEvent } from '@nthstock/contracts';
import { OrderBook } from '@nthstock/paperEngine';
import { shardOf } from '@nthstock/utils';
import { describe, expect, it, vi } from 'vitest';
import { startAlertDesk, type ActiveBookAlert, type AlertStore } from './alerts.js';

// NSTOCK-0383: the matcher puts the shard's active alerts on its books, stores what a tick fires,
// and publishes the notification.

const SHARDS = 4;
const SHARD = 1;
const tokens = Array.from({ length: 40 }, (_, i) => i + 1);
const [MINE = 0] = tokens.filter((t) => shardOf(t, SHARDS) === SHARD);
const OTHER = tokens.find((t) => shardOf(t, SHARDS) !== SHARD) ?? 0;

const alertAt = (alertId: string, token: number, price = 100_00): ActiveBookAlert => ({
  alertId,
  userId: 'u1',
  token,
  condition: 'ABOVE',
  price,
});

const eventFor = (alertId: string): NotificationEvent => ({
  v: NOTIFICATION_EVENT_VERSION,
  userId: 'u1',
  notification: {
    id: `n-${alertId}`,
    kind: 'PRICE_ALERT',
    title: 'SYM crossed above ₹100.00',
    body: 'Now ₹100.50',
    symbol: 'SYM',
    exchange: 'NSE',
    at: '2026-09-28T05:00:00.000Z',
    read: false,
  },
});

function harness(store: Partial<AlertStore> & { active: AlertStore['active'] }) {
  const books = new Map<number, OrderBook>();
  const book = (token: number) => {
    let found = books.get(token);
    if (!found) {
      found = new OrderBook();
      books.set(token, found);
    }
    return found;
  };
  const warn = vi.fn();
  const publish = vi.fn<(channel: string, message: string) => Promise<number>>(() =>
    Promise.resolve(1),
  );
  const full: AlertStore = {
    fire: (alertId) => Promise.resolve(eventFor(alertId)),
    published: () => Promise.resolve(),
    ...store,
  };
  const desk = startAlertDesk({
    store: full,
    publisher: { publish },
    shard: SHARD,
    shards: SHARDS,
    books,
    book,
    log: { info: () => undefined, warn },
    timer: null,
  });
  return { desk, books, book, publish, warn };
}

describe('startAlertDesk (NSTOCK-0383)', () => {
  it('reloads on its timer until stopped', async () => {
    const active = vi.fn(() => Promise.resolve([alertAt('a1', MINE)]));
    let tick: (() => void) | undefined;
    const setIntervalFake = vi.fn((callback: () => void, ms?: number) => {
      tick = callback;
      return ms as unknown as ReturnType<typeof setInterval>;
    });
    const clearIntervalFake = vi.fn();
    const books = new Map<number, OrderBook>();
    const book = (token: number) => {
      let found = books.get(token);
      if (!found) {
        found = new OrderBook();
        books.set(token, found);
      }
      return found;
    };
    const desk = startAlertDesk({
      store: {
        active,
        fire: (alertId) => Promise.resolve(eventFor(alertId)),
        published: () => Promise.resolve(),
      },
      publisher: { publish: () => Promise.resolve(1) },
      shard: SHARD,
      shards: SHARDS,
      books,
      book,
      log: { info: () => undefined, warn: () => undefined },
      everyMs: 5_000,
      timer: {
        setInterval: setIntervalFake as unknown as typeof setInterval,
        clearInterval: clearIntervalFake as unknown as typeof clearInterval,
      },
    });
    await desk.ready();
    expect(setIntervalFake).toHaveBeenCalledWith(expect.any(Function), 5_000);
    expect(active).toHaveBeenCalledTimes(1);

    tick?.();
    await vi.waitFor(() => {
      expect(active).toHaveBeenCalledTimes(2);
    });

    await desk.stop();
    expect(clearIntervalFake).toHaveBeenCalledTimes(1);
  });

  it("loads only this shard's active alerts onto the books", async () => {
    const { desk, books } = harness({
      active: () => Promise.resolve([alertAt('a1', MINE), alertAt('a2', OTHER)]),
    });
    await desk.ready();
    expect(books.get(MINE)?.hasAlert('a1')).toBe(true);
    expect(books.has(OTHER)).toBe(false);
    await desk.stop();
  });

  it('a reload adds a lost alert and removes an ended one, but keeps one added meanwhile', async () => {
    let active = [alertAt('a1', MINE), alertAt('a2', MINE)];
    const meanwhile: { add?: () => void } = {};
    const { desk, book } = harness({
      active: () => {
        meanwhile.add?.();
        return Promise.resolve(active);
      },
    });
    await desk.ready();
    active = [alertAt('a2', MINE), alertAt('a3', MINE)];
    // An ALERT_ADD that lands while the read is in flight is not in it, and must stay.
    meanwhile.add = () => book(MINE).addAlert(alertAt('a4', MINE));
    expect(await desk.reload()).toEqual({ added: 1, removed: 1 });
    expect([...book(MINE).alerts()].map((a) => a.alertId).sort()).toEqual(['a2', 'a3', 'a4']);
    await desk.stop();
  });

  it('a failed reload is warned once and the books keep what they had', async () => {
    let fail = false;
    const { desk, book, warn } = harness({
      active: () =>
        fail ? Promise.reject(new Error('down')) : Promise.resolve([alertAt('a1', MINE)]),
    });
    await desk.ready();
    fail = true;
    expect(await desk.reload()).toBeNull();
    expect(await desk.reload()).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(book(MINE).hasAlert('a1')).toBe(true);
    await desk.stop();
  });

  it('stores a fired alert, publishes it on the user channel and clears its outbox row', async () => {
    const published = vi.fn<(id: string) => Promise<void>>(() => Promise.resolve());
    const { desk, publish } = harness({ active: () => Promise.resolve([]), published });
    desk.onAlerts({
      token: MINE,
      symbol: 'SYM',
      ltp: 100_50,
      ts: '',
      alerts: [alertAt('a1', MINE)],
    });
    await desk.settled();
    expect(publish).toHaveBeenCalledTimes(1);
    const [channel, message] = publish.mock.calls[0] ?? [];
    expect(channel).toBe('nthstock:notify:v1:u1');
    expect(JSON.parse(message ?? '{}')).toEqual(eventFor('a1'));
    expect(published).toHaveBeenCalledWith('n-a1');
    await desk.stop();
  });

  it('publishes nothing when the alert already fired elsewhere', async () => {
    const { desk, publish } = harness({
      active: () => Promise.resolve([]),
      fire: () => Promise.resolve(null),
    });
    desk.onAlerts({
      token: MINE,
      symbol: 'SYM',
      ltp: 100_50,
      ts: '',
      alerts: [alertAt('a1', MINE)],
    });
    await desk.settled();
    expect(publish).not.toHaveBeenCalled();
    await desk.stop();
  });

  it('puts the alert back on its book when it could not be stored, and warns without its text', async () => {
    const { desk, book, warn } = harness({
      active: () => Promise.resolve([]),
      fire: () => Promise.reject(new Error('insert failed: secret note')),
    });
    desk.onAlerts({
      token: MINE,
      symbol: 'SYM',
      ltp: 100_50,
      ts: '',
      alerts: [alertAt('a1', MINE)],
    });
    await desk.settled();
    expect(book(MINE).hasAlert('a1')).toBe(true);
    expect(warn).toHaveBeenCalledWith(
      'Alert could not be stored; it stays on the book',
      expect.objectContaining({ alertId: 'a1', error: 'Error' }),
    );
    await desk.stop();
  });

  it('leaves a notification it could not publish to the outbox relay', async () => {
    const published = vi.fn(() => Promise.resolve());
    const { desk, publish, warn } = harness({ active: () => Promise.resolve([]), published });
    publish.mockRejectedValueOnce(new Error('redis down'));
    desk.onAlerts({
      token: MINE,
      symbol: 'SYM',
      ltp: 100_50,
      ts: '',
      alerts: [alertAt('a1', MINE)],
    });
    await desk.settled();
    expect(published).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      'Alert notification not published; the outbox relay will send it',
      expect.objectContaining({ notificationId: 'n-a1' }),
    );
    await desk.stop();
  });
});
