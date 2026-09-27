import type { ApiClient } from '@nthstock/apiClient';
import { fixedClock, fromIst } from '@nthstock/utils';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  onTestFinished,
} from 'vitest';
import { createMockServer } from '@/mocks/node';
import type { MarketSession } from '@/shared/lib/marketSessionContext';
import { createTestQuoteStore, testQuote } from '@/test/quotes';
import { renderWithProviders } from '@/test/renderWithProviders';
import { installResizeObserver } from '@/test/resizeObserver';
import { resetSession } from '@/test/session';
import { fakeLayout, findStock, loginOnMock } from '@/test/watchlists';
import { fundsKeys } from '../api/fundsQuery';
import { FundsPage } from './FundsPage';

/** Monday 28 Sep 2026, 10:00 IST: NSE is open. */
const OPEN_MS = fromIst(2026, 9, 28, 10 * 60).getTime();
// Each case logs in and makes many round trips on the MSW node server; CI runners are slow.
const HEAVY = 40_000;
const PRICE = 1_500_00;

const mock = createMockServer({
  clock: fixedClock(OPEN_MS),
  tickIntervalMs: 1_000_000_000,
  auth: { now: () => OPEN_MS },
});
const session: MarketSession = { clock: fixedClock(OPEN_MS), alwaysOpen: false };
const requests: URL[] = [];
mock.server.events.on('request:start', ({ request }) => {
  requests.push(new URL(request.url));
});

let mobileSeq = 0;
const nextMobile = () => `98177${String(10_000 + (mobileSeq += 1)).slice(-5)}`;

async function setup(): Promise<{ api: ApiClient; token: number }> {
  const api = await loginOnMock(nextMobile(), 'http://funds.test');
  const { token } = await findStock(api, 'INFY');
  mock.orders.pinPrice(token, PRICE);
  return { api, token };
}

const buy = (api: ApiClient, token: number, qty: number, extra: Record<string, unknown> = {}) =>
  api.request('orderPlace', {
    body: { token, side: 'BUY', type: 'MARKET', product: 'DELIVERY', qty, ...extra },
  });

function renderFunds(api: ApiClient) {
  const quotes = createTestQuoteStore();
  const view = renderWithProviders(<FundsPage />, {
    apiClient: api,
    quoteStore: quotes.store,
    marketSession: session,
  });
  return { ...view, quotes };
}

/** The summary's figure for `label`, as shown. */
function figure(label: string): string {
  const summary = screen.getByRole('region', { name: 'Funds summary' });
  return within(summary).getByText(label).nextElementSibling?.textContent ?? '';
}

beforeAll(() => {
  mock.server.listen({ onUnhandledRequest: 'error' });
});
beforeEach(() => {
  installResizeObserver();
  requests.length = 0;
});
afterEach(() => {
  resetSession();
});
afterAll(() => {
  mock.server.close();
  mock.orders.dispose();
  mock.adapter.dispose();
});

describe('funds summary (T-158)', () => {
  it(
    'after a ₹15,000 buy, available drops by ₹15,000.00 and the total holds until the price moves',
    async () => {
      const { api, token } = await setup();
      const { queryClient, quotes } = renderFunds(api);
      await screen.findByRole('region', { name: 'Funds summary' });
      expect(figure('Available cash')).toBe('₹10,00,000.00');
      expect(figure('Total')).toBe('₹10,00,000.00');
      expect(figure('Invested')).toBe('₹0.00');
      expect(screen.getByText('Opening balance ₹10,00,000.00')).toBeInTheDocument();

      await buy(api, token, 10); // 10 × ₹1,500.00
      await act(() => queryClient.invalidateQueries());
      await waitFor(() => expect(figure('Available cash')).toBe('₹9,85,000.00'));
      expect(figure('Invested')).toBe('₹15,000.00');
      expect(figure('Total')).toBe('₹10,00,000.00');
      expect(figure('Blocked for open orders')).toBe('₹0.00');

      // A resting limit buy blocks cash; the total is still unchanged.
      await buy(api, token, 2, { type: 'LIMIT', price: PRICE - 100_00 });
      await act(() => queryClient.invalidateQueries());
      await waitFor(() => expect(figure('Blocked for open orders')).toBe('₹2,800.00'));
      expect(figure('Available cash')).toBe('₹9,82,200.00');
      expect(figure('Total')).toBe('₹10,00,000.00');

      // Then the price moves: the total follows the position's live value.
      act(() => {
        quotes.push(testQuote('INFY', PRICE + 10_00));
      });
      expect(figure('Total')).toBe('₹10,00,100.00');
      expect(figure('Invested')).toBe('₹15,000.00');
    },
    HEAVY,
  );

  it('shows an error with Retry when funds cannot load', async () => {
    renderWithProviders(<FundsPage />);
    const alerts = await screen.findAllByRole('alert');
    expect(alerts.map((a) => a.textContent).join(' ')).toContain('Your funds could not load');
    fireEvent.click(screen.getAllByRole('button', { name: 'Retry' })[0] as HTMLElement);
    await waitFor(() => expect(screen.getAllByRole('alert').length).toBeGreaterThan(0));
  });
});

describe('funds ledger (T-159)', () => {
  it(
    'shows type, signed amount, balance after and IST time, and scrolling to the end loads the next page',
    async () => {
      const restore = fakeLayout(640);
      try {
        const { api, token } = await setup();
        // 17 market buys: a block, a release and a debit each, plus the opening credit = 52.
        for (let i = 0; i < 17; i += 1) await buy(api, token, 1);
        renderFunds(api);
        const grid = await screen.findByRole('grid', { name: 'Funds ledger' });
        expect(grid).toHaveAttribute('aria-rowcount', String(50 + 1));
        const first = within(grid).getAllByRole('row')[1] as HTMLElement;
        expect(first).toHaveTextContent('Buy');
        expect(first).toHaveTextContent('-₹1,500.00');
        expect(first).toHaveTextContent('debit ₹1,500.00');
        expect(first).toHaveTextContent('₹9,74,500.00');
        expect(first).toHaveTextContent(/28 Sept? 2026, 10:00:00 am/i);
        const ledgerCalls = () => requests.filter((url) => url.pathname === '/v1/funds/ledger');
        expect(ledgerCalls()).toHaveLength(1);

        grid.scrollTop = 51 * 48 - 640;
        fireEvent.scroll(grid);
        await waitFor(() => expect(grid).toHaveAttribute('aria-rowcount', String(52 + 1)));
        expect(ledgerCalls()).toHaveLength(2);
        expect(ledgerCalls()[1]?.searchParams.get('cursor')).toBeTruthy();
        expect(await screen.findByText('That is the start of your ledger.')).toBeInTheDocument();
      } finally {
        restore();
      }
    },
    HEAVY,
  );
});

describe('reset paper balance (T-160)', () => {
  it(
    'needs RESET typed, then funds show ₹10,00,000.00 and orders, positions and holdings are empty',
    async () => {
      const restore = fakeLayout(640);
      onTestFinished(restore);
      const { api, token } = await setup();
      await buy(api, token, 10);
      await buy(api, token, 3, { type: 'LIMIT', price: PRICE - 100_00 });
      const { queryClient } = renderFunds(api);
      await waitFor(() => expect(figure('Available cash')).toBe('₹9,80,800.00'));

      const open = screen.getByRole('button', { name: 'Reset paper balance' });
      open.focus();
      fireEvent.click(open);
      const dialog = await screen.findByRole('dialog', { name: 'Reset your paper balance?' });
      expect(dialog).toHaveTextContent('Open orders and AMOs are cancelled');
      expect(dialog).toHaveTextContent('All positions and holdings are cleared');
      const field = within(dialog).getByRole('textbox', { name: 'Type RESET to confirm' });
      await waitFor(() => expect(field).toHaveFocus());
      const confirm = within(dialog).getByRole('button', { name: 'Reset balance' });
      expect(confirm).toBeDisabled();
      fireEvent.change(field, { target: { value: 'reset' } });
      expect(confirm).toBeDisabled();

      // Keep my account closes it and changes nothing; the field starts empty next time.
      fireEvent.click(within(dialog).getByRole('button', { name: 'Keep my account' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      await waitFor(() => expect(open).toHaveFocus());
      fireEvent.click(open);
      const again = await screen.findByRole('dialog', { name: 'Reset your paper balance?' });
      const retyped = within(again).getByRole('textbox', { name: 'Type RESET to confirm' });
      expect(retyped).toHaveValue('');
      fireEvent.change(retyped, { target: { value: 'RESET' } });
      const enabled = within(again).getByRole('button', { name: 'Reset balance' });
      expect(enabled).toBeEnabled();
      fireEvent.click(enabled);

      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      expect(await screen.findByText('Paper balance reset')).toBeInTheDocument();
      await waitFor(() => expect(figure('Available cash')).toBe('₹10,00,000.00'));
      await waitFor(() => expect(figure('Invested')).toBe('₹0.00'));
      expect(figure('Blocked for open orders')).toBe('₹0.00');
      expect(figure('Total')).toBe('₹10,00,000.00');
      const grid = await screen.findByRole('grid', { name: 'Funds ledger' });
      await waitFor(() => expect(within(grid).getAllByRole('row')[1]).toHaveTextContent('Reset'));
      expect(queryClient.getQueryState(fundsKeys.summary())?.isInvalidated).toBe(false);

      expect((await api.request('ordersList')).items).toEqual([]);
      expect((await api.request('positionsList')).items).toEqual([]);
      expect((await api.request('holdingsList')).items).toEqual([]);
    },
    HEAVY,
  );

  it(
    'a failed reset keeps the dialog open and says so',
    async () => {
      const { api } = await setup();
      renderFunds(api);
      await screen.findByRole('region', { name: 'Funds summary' });
      fireEvent.click(screen.getByRole('button', { name: 'Reset paper balance' }));
      const dialog = await screen.findByRole('dialog', { name: 'Reset your paper balance?' });
      mock.server.close();
      try {
        fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'RESET' } });
        fireEvent.submit(within(dialog).getByRole('textbox').closest('form') as HTMLFormElement);
        expect(await screen.findByText('Paper balance not reset')).toBeInTheDocument();
        expect(
          screen.getByRole('dialog', { name: 'Reset your paper balance?' }),
        ).toBeInTheDocument();
      } finally {
        mock.server.listen({ onUnhandledRequest: 'error' });
      }
    },
    HEAVY,
  );
});
