import type { ApiClient } from '@nthstock/apiClient';
import type { PriceAlert } from '@nthstock/contracts';
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

type Behaviour = {
  alerts: 'ok' | 'fail' | 'pending';
  notifications: 'ok' | 'fail' | 'pending';
  cancel: 'ok' | 'fail';
};

const never = new Promise<never>(() => undefined);

function fakeApi(behaviour: Behaviour) {
  return {
    request: (name: string) => {
      if (name === 'notificationsList') {
        if (behaviour.notifications === 'pending') return never;
        if (behaviour.notifications === 'fail') return Promise.reject(new TypeError('offline'));
        return Promise.resolve({ items: [], unread: 0 });
      }
      if (name === 'priceAlertsList') {
        if (behaviour.alerts === 'pending') return never;
        if (behaviour.alerts === 'fail') return Promise.reject(new TypeError('offline'));
        return Promise.resolve({ items: [alert] });
      }
      if (name === 'priceAlertCancel') {
        return behaviour.cancel === 'fail'
          ? Promise.reject(new TypeError('offline'))
          : Promise.resolve(undefined);
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
    fireEvent.mouseDown(within(centre).getByRole('tab', { name: strings.centre.tabs.alerts }));
    fireEvent.click(within(centre).getByRole('tab', { name: strings.centre.tabs.alerts }));
    expect(await within(centre).findByRole('status')).toBeVisible();
    expect(within(centre).queryByText(strings.alerts.empty)).not.toBeInTheDocument();
  });

  it('shows an error with retry when alerts fail to load', async () => {
    const centre = await openCentre({ ...base, alerts: 'fail' });
    fireEvent.mouseDown(within(centre).getByRole('tab', { name: strings.centre.tabs.alerts }));
    fireEvent.click(within(centre).getByRole('tab', { name: strings.centre.tabs.alerts }));
    expect(await within(centre).findByText(strings.centre.alertsLoadError)).toBeVisible();
    expect(within(centre).getByRole('button', { name: strings.centre.retry })).toBeInTheDocument();
    expect(within(centre).queryByText(strings.alerts.empty)).not.toBeInTheDocument();
  });

  it('tells the user when removing an alert fails', async () => {
    const centre = await openCentre({ ...base, cancel: 'fail' });
    fireEvent.mouseDown(within(centre).getByRole('tab', { name: strings.centre.tabs.alerts }));
    fireEvent.click(within(centre).getByRole('tab', { name: strings.centre.tabs.alerts }));
    fireEvent.click(
      await within(centre).findByRole('button', { name: strings.alerts.remove('INFY') }),
    );
    await waitFor(() =>
      expect(screen.getByText(strings.alerts.removeError('INFY'))).toBeInTheDocument(),
    );
  });
});
