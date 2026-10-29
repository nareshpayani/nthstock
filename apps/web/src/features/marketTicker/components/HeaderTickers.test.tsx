import { act, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useConnectivityStore, type PageState } from '@/shared/lib/connectivity';
import { createTestQuoteStore, testQuote } from '@/test/quotes';
import { renderWithProviders } from '@/test/renderWithProviders';
import { HeaderTickers } from './HeaderTickers';

afterEach(() => {
  useConnectivityStore.setState({
    browserOffline: false,
    socketDown: false,
    since: null,
    forced: 'live',
  });
});

const force = (state: PageState) =>
  act(() => {
    useConnectivityStore.getState().setForced(state);
  });

function setup(withQuotes: boolean) {
  const quotes = createTestQuoteStore();
  if (withQuotes) {
    quotes.push(
      testQuote('NIFTY50', 2_400_000, { prevClose: 2_390_000 }),
      testQuote('SENSEX', 7_900_000, { exchange: 'BSE', prevClose: 7_890_000 }),
    );
  }
  renderWithProviders(<HeaderTickers />, { quoteStore: quotes.store });
}

describe('HeaderTickers states (CR-T18, SPEC-CR-1 §7)', () => {
  it('loading: one skeleton per index until a quote arrives', async () => {
    setup(false);
    const group = await screen.findByRole('group');
    expect(group.querySelectorAll('[aria-busy="true"]')).toHaveLength(2);
  });

  it('forced loading shows skeletons even with quotes', async () => {
    setup(true);
    const group = await screen.findByRole('group');
    expect(group.querySelectorAll('[aria-busy="true"]')).toHaveLength(0);
    force('loading');
    expect(group.querySelectorAll('[aria-busy="true"]')).toHaveLength(2);
  });

  it('error: the indices are hidden', async () => {
    setup(true);
    const group = await screen.findByRole('group');
    expect(group).toHaveTextContent('NIFTY');
    force('error');
    expect(group).not.toHaveTextContent('NIFTY');
    expect(group).not.toHaveTextContent('SENSEX');
  });

  it('offline: a Stale chip, the levels stay and are dimmed', async () => {
    setup(true);
    const group = await screen.findByRole('group');
    expect(screen.queryByTestId('tickers-stale')).not.toBeInTheDocument();
    force('offline');
    expect(screen.getByTestId('tickers-stale')).toHaveTextContent('Stale');
    expect(group).toHaveAttribute('data-stale', 'true');
    expect(group).toHaveTextContent('NIFTY');
    force('live');
    expect(screen.queryByTestId('tickers-stale')).not.toBeInTheDocument();
  });
});

describe('HeaderTickers links (NSTOCK-0437)', () => {
  it('each index opens its chart page', async () => {
    setup(true);
    expect(await screen.findByRole('link', { name: /^NIFTY 50/ })).toHaveAttribute(
      'href',
      '/stocks/NIFTY50?exchange=NSE',
    );
    expect(screen.getByRole('link', { name: /^SENSEX/ })).toHaveAttribute(
      'href',
      '/stocks/SENSEX?exchange=BSE',
    );
  });
});
