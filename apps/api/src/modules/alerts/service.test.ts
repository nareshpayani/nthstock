import type { Quote } from '@nthstock/contracts';
import type { MarketDataAdapter } from '@nthstock/marketData';
import { describe, expect, it, vi } from 'vitest';
import { manualClock } from '../../test/manualClock.js';
import { createMemoryNotificationsRepo, createNotifier } from '../notifications/index.js';
import { createAlertService } from './service.js';

// Fired alerts become stored PRICE_ALERT notifications; one that cannot be stored is reported with
// its ids (NSTOCK-0379).

const quote = (ltp: number) =>
  ({ token: 1594, symbol: 'INFY', exchange: 'NSE', ltp }) as unknown as Quote;

function setup() {
  const clock = manualClock('2026-09-25T04:30:00.000Z');
  let onQuotes: (quotes: Quote[]) => void = () => undefined;
  const market = {
    getQuote: () => Promise.resolve(quote(1_500_00)),
    subscribe: (_symbols: string[], listener: (quotes: Quote[]) => void) => {
      onQuotes = listener;
      return () => undefined;
    },
  } as unknown as MarketDataAdapter;
  const repo = createMemoryNotificationsRepo({ clock });
  const notifier = createNotifier({ repo });
  const onNotifyError = vi.fn();
  const alerts = createAlertService({ clock, market, notifier, onNotifyError });
  return { alerts, repo, notifier, onNotifyError, tick: (ltp: number) => onQuotes([quote(ltp)]) };
}

const above = { symbol: 'INFY', exchange: 'NSE', condition: 'ABOVE', price: 1_530_00 } as const;

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
    const { alerts, repo, onNotifyError, tick } = setup();
    const alert = await alerts.create('usr_a', above);
    vi.spyOn(repo, 'appendMany').mockRejectedValueOnce(new Error('postgres down'));
    tick(1_531_00);

    await vi.waitFor(() => {
      expect(onNotifyError).toHaveBeenCalledWith(expect.any(Error), {
        userId: 'usr_a',
        alertId: alert.id,
      });
    });
    alerts.dispose();
  });
});
