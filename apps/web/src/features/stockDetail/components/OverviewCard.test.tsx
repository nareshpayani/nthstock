import type { InstrumentProfile } from '@nthstock/contracts';
import { fireEvent, screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { TEST_API_ORIGIN } from '@/mocks/node';
import { chartsMock } from '@/test/chartsMock';
import { createMockApi } from '@/test/mockApi';
import { renderApp } from '@/test/renderApp';
import { installResizeObserver } from '@/test/resizeObserver';
import { resetSession } from '@/test/session';

vi.mock('lightweight-charts', () => import('@/test/chartsMock'));

const api = createMockApi();
beforeAll(() => api.listen());
afterEach(() => api.reset());
afterAll(() => api.close());
beforeEach(() => {
  installResizeObserver();
  chartsMock.reset();
});
afterEach(() => {
  vi.unstubAllGlobals();
  resetSession();
});

const profileUrl = `${TEST_API_ORIGIN}/v1/market/instruments/:symbol/profile`;

async function openOverview(url: string) {
  const view = renderApp(url, { apiClient: api.apiClient });
  const card = await screen.findByRole('region', { name: 'Overview' });
  await within(card).findByRole('heading', { level: 3 });
  return { card, router: view.router };
}

describe('overview (T-111)', () => {
  it('shows sector, size and index chips from the profile', async () => {
    const profile = (await api.adapter.getProfile('INFY')) as InstrumentProfile;
    const { card } = await openOverview('/stocks/INFY');

    expect(within(card).getByRole('heading', { name: 'About Infosys Ltd' })).toBeInTheDocument();
    expect(
      within(card).getByText('Sector', { selector: 'dt' }).nextElementSibling,
    ).toHaveTextContent('Information Technology');
    expect(within(card).getByText('Size', { selector: 'dt' }).nextElementSibling).toHaveTextContent(
      'Large cap',
    );
    const links = within(card).getAllByRole('link');
    expect(links.map((link) => link.getAttribute('href'))).toEqual(
      profile.indices.map((index) => `/stocks/${index.symbol}`),
    );
    expect(within(card).getByRole('link', { name: 'NIFTY IT index' })).toBeInTheDocument();
  });

  it('collapses long about text behind Read more, and expands and collapses it again', async () => {
    const profile = (await api.adapter.getProfile('INFY')) as InstrumentProfile;
    const { card } = await openOverview('/stocks/INFY');
    const heading = within(card).getByRole('heading', { name: 'About Infosys Ltd' });
    const text = heading.nextElementSibling as HTMLElement;

    const more = within(card).getByRole('button', { name: 'Read more' });
    expect(more).toHaveAttribute('aria-expanded', 'false');
    expect(more).toHaveAttribute('aria-controls', text.id);
    expect(text.textContent).toMatch(/…$/);
    expect(text.textContent.length).toBeLessThan(profile.about.length);

    // The same button toggles, so keyboard focus stays on it.
    more.focus();
    fireEvent.click(more);
    const less = within(card).getByRole('button', { name: 'Read less' });
    expect(less).toHaveAttribute('aria-expanded', 'true');
    expect(text).toHaveTextContent(profile.about);

    fireEvent.click(less);
    expect(within(card).getByRole('button', { name: 'Read more' })).toBe(more);
    expect(more).toHaveFocus();
    expect(text.textContent).toMatch(/…$/);
  });

  it('shows short text whole, with no button, and says when there are no indices', async () => {
    const profile: InstrumentProfile = {
      token: 1,
      symbol: 'INFY',
      exchange: 'NSE',
      name: 'Infosys Ltd',
      sector: 'Information Technology',
      capCategory: 'MID',
      about: 'A short description.',
      indices: [],
    };
    api.server.use(http.get(profileUrl, () => HttpResponse.json(profile)));
    const { card } = await openOverview('/stocks/INFY');
    expect(within(card).getByText('A short description.')).toBeInTheDocument();
    expect(within(card).queryByRole('button')).not.toBeInTheDocument();
    expect(within(card).getByText('Not in a headline index')).toBeInTheDocument();
    expect(within(card).getByText('Mid cap')).toBeInTheDocument();
  });

  it('opens an index page from its chip', async () => {
    const { card, router } = await openOverview('/stocks/INFY');
    fireEvent.click(within(card).getByRole('link', { name: 'NIFTY 50 index' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'NIFTY 50' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/stocks/NIFTY50');
  });

  it('shows an error with a retry when the profile fails', async () => {
    api.server.use(http.get(profileUrl, () => new HttpResponse(null, { status: 500 })));
    renderApp('/stocks/INFY', { apiClient: api.apiClient });
    const card = await screen.findByRole('region', { name: 'Overview' });
    expect(await within(card).findByText('Overview unavailable')).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('is not shown for an index', async () => {
    renderApp('/stocks/NIFTY50', { apiClient: api.apiClient });
    await screen.findByRole('heading', { level: 1 });
    expect(screen.queryByRole('region', { name: 'Overview' })).not.toBeInTheDocument();
    expect(api.requestsTo('/profile')).toHaveLength(0);
  });
});
