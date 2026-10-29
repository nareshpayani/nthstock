import type { ApiClient } from '@nthstock/apiClient';
import type { Notification, PriceAlert } from '@nthstock/contracts';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { renderWithProviders } from '@/test/renderWithProviders';
import { resetSession, signIn } from '@/test/session';
import { strings } from '../strings';
import { NotificationBell } from './NotificationBell';

const alert = {
  id: 'alt_1',
  token: 408065,
  symbol: 'INFY',
  exchange: 'NSE',
  condition: 'ABOVE',
  price: 153000,
  note: null,
  status: 'ACTIVE',
  createdAt: '2026-10-25T04:00:00.000Z',
  createdLtp: 150000,
  triggeredAt: null,
  triggeredLtp: null,
} as PriceAlert;

const alertTwo = { ...alert, id: 'alt_2', symbol: 'TCS' } as PriceAlert;

const unreadItem = {
  id: 'ntf_1',
  kind: 'PRICE_ALERT',
  title: 'INFY crossed 1,530',
  body: null,
  at: '2026-10-25T05:00:00.000Z',
  read: false,
} as unknown as Notification;

type Behaviour = {
  alerts: 'ok' | 'fail' | 'pending';
  notifications: 'ok' | 'fail' | 'pending' | 'unread';
  cancel: 'ok' | 'fail' | 'first-fails';
  markRead?: 'fail';
  /** Counts `notificationsList` calls, to prove retry refetches. */
  listCalls?: { count: number };
};

const never = new Promise<never>(() => undefined);

function fakeApi(behaviour: Behaviour) {
  let cancelCalls = 0;
  return {
    request: (name: string) => {
      if (name === 'notificationsList') {
        if (behaviour.listCalls) behaviour.listCalls.count += 1;
        if (behaviour.notifications === 'pending') return never;
        if (behaviour.notifications === 'fail') return Promise.reject(new TypeError('offline'));
        if (behaviour.notifications === 'unread') {
          return Promise.resolve({ items: [unreadItem], unread: 1 });
        }
        return Promise.resolve({ items: [], unread: 0 });
      }
      if (name === 'priceAlertsList') {
        if (behaviour.alerts === 'pending') return never;
        if (behaviour.alerts === 'fail') return Promise.reject(new TypeError('offline'));
        return Promise.resolve({ items: [alert, alertTwo] });
      }
      if (name === 'priceAlertCancel') {
        cancelCalls += 1;
        const fails =
          behaviour.cancel === 'fail' || (behaviour.cancel === 'first-fails' && cancelCalls === 1);
        return fails ? Promise.reject(new TypeError('offline')) : Promise.resolve(undefined);
      }
      if (name === 'notificationsMarkRead') {
        return behaviour.markRead === 'fail'
          ? Promise.reject(new TypeError('offline'))
          : Promise.resolve({ items: [{ ...unreadItem, read: true }], unread: 0 });
      }
      return Promise.reject(new TypeError('unexpected'));
    },
    url: () => 'http://offline.test',
  } as unknown as ApiClient;
}

async function openCentre(behaviour: Behaviour) {
  renderWithProviders(<NotificationBell />, { apiClient: fakeApi(behaviour) });
  fireEvent.click(await screen.findByRole('button', { name: strings.bell.label }));
  return screen.findByRole('dialog');
}

function openAlertsTab(centre: HTMLElement) {
  const tab = within(centre).getByRole('tab', { name: strings.centre.tabs.alerts });
  fireEvent.mouseDown(tab);
  fireEvent.click(tab);
}

const base: Behaviour = { alerts: 'ok', notifications: 'ok', cancel: 'ok' };

beforeEach(() => {
  signIn();
});

afterEach(() => {
  resetSession();
});

describe('NotificationBell states (NSTOCK-0463)', () => {
  it('shows a skeleton, not the empty state, while notifications load', async () => {
    const centre = await openCentre({ ...base, notifications: 'pending' });
    expect(within(centre).getByRole('status', { name: strings.centre.loading })).toBeVisible();
    expect(within(centre).queryByText(strings.centre.empty)).not.toBeInTheDocument();
  });

  it('shows a skeleton, not "no alerts", while alerts load', async () => {
    const centre = await openCentre({ ...base, alerts: 'pending' });
    openAlertsTab(centre);
    expect(
      await within(centre).findByRole('status', { name: strings.centre.loading }),
    ).toBeVisible();
    expect(within(centre).queryByText(strings.alerts.empty)).not.toBeInTheDocument();
  });

  it('shows an error with retry when alerts fail to load', async () => {
    const centre = await openCentre({ ...base, alerts: 'fail' });
    openAlertsTab(centre);
    expect(await within(centre).findByText(strings.centre.alertsLoadError)).toBeVisible();
    expect(within(centre).getByRole('button', { name: strings.centre.retry })).toBeInTheDocument();
    expect(within(centre).queryByText(strings.alerts.empty)).not.toBeInTheDocument();
  });

  it('shows an error with retry, and no empty state, when notifications fail to load', async () => {
    const listCalls = { count: 0 };
    const centre = await openCentre({ ...base, notifications: 'fail', listCalls });
    expect(await within(centre).findByText(strings.centre.loadError)).toBeVisible();
    expect(within(centre).queryByText(strings.centre.empty)).not.toBeInTheDocument();
    const before = listCalls.count;
    fireEvent.click(within(centre).getByRole('button', { name: strings.centre.retry }));
    await waitFor(() => expect(listCalls.count).toBeGreaterThan(before));
  });

  it('tells the user when removing an alert fails, and the row is usable again', async () => {
    const centre = await openCentre({ ...base, cancel: 'fail' });
    openAlertsTab(centre);
    fireEvent.click(
      await within(centre).findByRole('button', { name: strings.alerts.remove('INFY') }),
    );
    await waitFor(() =>
      expect(screen.getByText(strings.alerts.removeError('INFY'))).toBeInTheDocument(),
    );
    await waitFor(() =>
      expect(
        within(centre).getByRole('button', { name: strings.alerts.remove('INFY') }),
      ).toBeEnabled(),
    );
  });

  it('reports the first failed cancel even when a second remove follows at once', async () => {
    const centre = await openCentre({ ...base, cancel: 'first-fails' });
    openAlertsTab(centre);
    const infy = await within(centre).findByRole('button', { name: strings.alerts.remove('INFY') });
    const tcs = within(centre).getByRole('button', { name: strings.alerts.remove('TCS') });
    fireEvent.click(infy);
    fireEvent.click(tcs);
    expect(await screen.findByText(strings.alerts.removeError('INFY'))).toBeInTheDocument();
    await waitFor(() =>
      expect(
        within(centre).getByRole('button', { name: strings.alerts.remove('INFY') }),
      ).toBeEnabled(),
    );
  });

  it('shows an error toast when marking notifications read fails', async () => {
    renderWithProviders(<NotificationBell />, {
      apiClient: fakeApi({ ...base, notifications: 'unread', markRead: 'fail' }),
    });
    fireEvent.click(await screen.findByRole('button', { name: strings.bell.labelUnread(1) }));
    expect(await screen.findByText(strings.centre.markReadError)).toBeInTheDocument();
  });
});
