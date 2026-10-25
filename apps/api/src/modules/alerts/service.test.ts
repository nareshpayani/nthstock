import type { Quote } from '@nthstock/contracts';
import type { MarketDataAdapter } from '@nthstock/marketData';
import { describe, expect, it, vi } from 'vitest';
import { manualClock } from '../../test/manualClock.js';
import { createMemoryNotificationsRepo, createNotifier } from '../notifications/index.js';
import { createMemoryAlertsRepo, type AlertsRepo } from './repo.js';
import { createAlertService } from './service.js';

// Fired alerts become stored PRICE_ALERT notifications; one that cannot be stored is reported with
// its ids (NSTOCK-0379).

const quote = (ltp: number) =>
  ({ token: 1594, symbol: 'INFY', exchange: 'NSE', ltp }) as unknown as Quote;

const clock = manualClock('2026-09-25T04:30:00.000Z');

/** One API process on a shared store; `tick` feeds its market subscription. */
function process(shared: {
  repo: ReturnType<typeof createMemoryNotificationsRepo>;
  alertsRepo: AlertsRepo;
}) {
  const listeners = new Set<(quotes: Quote[]) => void>();
  const market = {
    getQuote: () => Promise.resolve(quote(1_500_00)),
    subscribe: (_symbols: string[], listener: (quotes: Quote[]) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  } as unknown as MarketDataAdapter;
  const notifier = createNotifier({ repo: shared.repo });
  const onNotifyError = vi.fn();
  const sendCommand = vi.fn();
  const alerts = createAlertService({
    clock,
    market,
    repo: shared.alertsRepo,
    notifier,
    onNotifyError,
    sendCommand,
  });
  const tick = (ltp: number) => {
    for (const listener of [...listeners]) listener([quote(ltp)]);
  };
  return { alerts, notifier, onNotifyError, sendCommand, tick, watching: () => listeners.size };
}

function setup() {
  const repo = createMemoryNotificationsRepo({ clock });
  const shared = { repo, alertsRepo: createMemoryAlertsRepo({ notifications: repo }) };
  return { ...process(shared), repo, shared };
}

const above = { symbol: 'INFY', exchange: 'NSE', condition: 'ABOVE', price: 1_530_00 } as const;

describe('alert service (NSTOCK-0383)', () => {
  it('refuses a level already passed and sends ALERT_ADD and ALERT_CANCEL to the matcher', async () => {
    const { alerts, sendCommand, watching } = setup();
    await expect(alerts.create('usr_a', { ...above, price: 1_490_00 })).rejects.toMatchObject({
      status: 400,
    });

    const alert = await alerts.create('usr_a', above);
    expect(sendCommand).toHaveBeenLastCalledWith({
      v: 1,
      token: 1594,
      version: 0,
      type: 'ALERT_ADD',
      alertId: alert.id,
      userId: 'usr_a',
      condition: 'ABOVE',
      price: 1_530_00,
    });
    expect(watching()).toBe(1);

    expect(await alerts.cancel('usr_a', alert.id)).toMatchObject({ status: 'CANCELLED' });
    expect(sendCommand).toHaveBeenLastCalledWith({
      v: 1,
      token: 1594,
      version: 0,
      type: 'ALERT_CANCEL',
      alertId: alert.id,
    });
    expect(watching()).toBe(0);
    await expect(alerts.cancel('usr_a', alert.id)).rejects.toMatchObject({ status: 409 });
    await expect(alerts.cancel('usr_b', alert.id)).rejects.toMatchObject({ status: 404 });
  });

  it('fires once when two processes see the crossing tick', async () => {
    const first = setup();
    const second = process(first.shared);
    const alert = await first.alerts.create('usr_a', above);
    await second.alerts.ready();

    first.tick(1_531_00);
    second.tick(1_531_00);
    await vi.waitFor(async () => {
      expect((await first.alerts.list('usr_a')).items[0]?.status).toBe('TRIGGERED');
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    const { items } = await first.alerts.notifications('usr_a');
    expect(items.filter((n) => n.kind === 'PRICE_ALERT')).toHaveLength(1);
    expect((await first.alerts.list('usr_a')).items[0]).toMatchObject({
      id: alert.id,
      triggeredLtp: 1_531_00,
    });
  });

  it('watches the stored alerts again after a restart and fires them', async () => {
    const before = setup();
    await before.alerts.create('usr_a', above);
    before.alerts.dispose();

    const after = process(before.shared);
    await after.alerts.ready();
    expect(after.watching()).toBe(1);
    after.tick(1_540_00);
    await vi.waitFor(async () => {
      expect((await after.alerts.notifications('usr_a')).items[0]).toMatchObject({
        kind: 'PRICE_ALERT',
        body: 'Now ₹1,540.00',
      });
    });
  });
});

describe('alert service notifications', () => {
  it('stores and announces a fired alert with the alert attached', async () => {
    const { alerts, notifier, tick } = setup();
    const heard = vi.fn();
    notifier.onCommitted(heard);
    const alert = await alerts.create('usr_a', above);
    tick(1_531_00);

    await vi.waitFor(() => {
      expect(heard).toHaveBeenCalledTimes(1);
    });
    expect(heard.mock.calls[0]?.[0]).toMatchObject({
      userId: 'usr_a',
      notification: { kind: 'PRICE_ALERT', title: 'INFY crossed above ₹1,530.00' },
      alert: { id: alert.id, status: 'TRIGGERED' },
    });
    expect((await alerts.notifications('usr_a')).unread).toBe(1);
    alerts.dispose();
  });

  it('reports a notification it could not store, with the user and alert ids', async () => {
    const { alerts, repo, onNotifyError, tick, watching } = setup();
    const alert = await alerts.create('usr_a', above);
    vi.spyOn(repo, 'appendMany').mockRejectedValueOnce(new Error('postgres down'));
    tick(1_531_00);

    await vi.waitFor(() => {
      expect(onNotifyError).toHaveBeenCalledWith(expect.any(Error), {
        userId: 'usr_a',
        alertId: alert.id,
      });
    });
    // Still ACTIVE and watched again, so the next crossing tick fires it.
    expect(watching()).toBe(1);
    expect((await alerts.list('usr_a')).items[0]?.status).toBe('ACTIVE');
    tick(1_532_00);
    await vi.waitFor(async () => {
      expect((await alerts.list('usr_a')).items[0]?.status).toBe('TRIGGERED');
    });
    alerts.dispose();
  });
});
