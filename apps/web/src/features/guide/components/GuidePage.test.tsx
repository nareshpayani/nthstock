import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { strings } from '../strings';
import { GuidePage } from './GuidePage';

function renderGuide() {
  const root = createRootRoute({ component: GuidePage });
  const router = createRouter({
    routeTree: root,
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  render(<RouterProvider router={router} />);
}

describe('GuidePage', () => {
  it('has one h1, a section per contents link, and sets the tab title', async () => {
    renderGuide();
    expect(await screen.findByRole('heading', { level: 1, name: strings.title })).toBeVisible();
    expect(document.title).toBe('Guide · nthstock');

    const toc = screen.getByRole('navigation', { name: strings.tocLabel });
    const links = within(toc).getAllByRole('link');
    expect(links.length).toBeGreaterThan(5);
    for (const link of links) {
      const id = link.getAttribute('href')?.slice(1) ?? '';
      const section = document.getElementById(id);
      expect(section, `section #${id}`).not.toBeNull();
      expect(
        within(section as HTMLElement).getByRole('heading', { level: 2, name: link.textContent }),
      ).toBeVisible();
    }
  });

  it('shows the demo login, the buy and sell steps, and the login link', async () => {
    renderGuide();
    expect(await screen.findByText('9000000001')).toBeVisible();
    expect(screen.getByText('123456')).toBeVisible();
    const buy = screen.getByRole('region', { name: strings.buy.title });
    expect(within(buy).getAllByRole('listitem')).toHaveLength(strings.buy.steps.length);
    const sell = screen.getByRole('region', { name: strings.sell.title });
    expect(within(sell).getAllByRole('listitem')).toHaveLength(strings.sell.steps.length);
    expect(screen.getByRole('link', { name: strings.tryIt.cta })).toHaveAttribute('href', '/login');
  });

  it('opens the source link in a new tab safely', async () => {
    renderGuide();
    const repo = await screen.findByRole('link', { name: strings.run.repoLabel });
    expect(repo).toHaveAttribute('href', strings.run.repoUrl);
    expect(repo).toHaveAttribute('target', '_blank');
    expect(repo).toHaveAttribute('rel', 'noopener noreferrer');
  });
});
