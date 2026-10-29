import type * as PhoneLayout from '@/shared/hooks/usePhoneLayout';
import type * as SessionClient from '@/shared/lib/sessionClient';
import { act, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { createApiClient } from '@nthstock/apiClient';
import { renderApp } from '@/test/renderApp';
import { resetSession, signIn, testSession } from '@/test/session';
import { initialTicketIntentState, useTicketIntentStore } from '@/shared/lib/ticketIntentStore';

vi.mock('@/shared/hooks/usePhoneLayout', async (importOriginal) => ({
  ...(await importOriginal<typeof PhoneLayout>()),
  usePhoneShell: () => true,
  usePhoneLayout: () => true,
}));

// The session check fails once, when the ticket opens (a network error mid-restore).
const ensureSession = vi.hoisted(() => ({ fail: false }));
vi.mock('@/shared/lib/sessionClient', async (importOriginal) => {
  const actual = await importOriginal<typeof SessionClient>();
  return {
    ...actual,
    ensureSession: (...args: Parameters<typeof actual.ensureSession>) => {
      if (!ensureSession.fail) return actual.ensureSession(...args);
      ensureSession.fail = false;
      return Promise.reject(new TypeError('offline'));
    },
  };
});

afterEach(() => {
  act(() => {
    resetSession();
    useTicketIntentStore.setState(initialTicketIntentState);
  });
});

const popularApi = createApiClient({
  baseUrl: 'http://popular.test',
  fetch: (input) =>
    new URL(String(input)).pathname === '/v1/market/search/popular'
      ? Promise.resolve(
          new Response(
            JSON.stringify({
              items: [
                {
                  token: 408065,
                  symbol: 'INFY',
                  exchange: 'NSE',
                  name: 'Infosys Ltd',
                  type: 'EQUITY',
                },
              ],
            }),
            { headers: { 'content-type': 'application/json' } },
          ),
        )
      : Promise.reject(new TypeError('offline')),
});

it('says the ticket did not open and clears its intent when opening it fails (NSTOCK-0466)', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  signIn(testSession({ name: 'Demo Investor' }));
  renderApp('/dashboard', { apiClient: popularApi });
  fireEvent.click(await screen.findByRole('button', { name: /^Trade:/ }));
  const sheet = await screen.findByRole('dialog', { name: 'Trade' });
  fireEvent.focus(within(sheet).getByRole('combobox', { name: 'Search stocks' }));
  const infy = await within(sheet).findByRole('option', { name: /INFY/ });
  ensureSession.fail = true;
  fireEvent.click(infy);
  expect(await screen.findByText('The order ticket did not open')).toBeInTheDocument();
  expect(screen.getByText('Tap Buy or Sell on INFY to try again.')).toBeInTheDocument();
  expect(useTicketIntentStore.getState().intent).toBeNull();
});
