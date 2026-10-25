import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { videoFile } from '../model/guideContent';
import { strings } from '../strings';
import { GuidePage } from './GuidePage';

/** The guide with its tab in local state, as the route keeps it in `?tab=`. */
function renderGuide(initialTab?: string, onSelectTab = vi.fn()) {
  function Harness() {
    const [tab, setTab] = useState(initialTab);
    return (
      <GuidePage
        tab={tab}
        onSelectTab={(id) => {
          onSelectTab(id);
          setTab(id);
        }}
      />
    );
  }
  const root = createRootRoute({ component: Harness });
  const router = createRouter({
    routeTree: root,
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  render(<RouterProvider router={router} />);
  return { onSelectTab };
}

const tabOf = (id: string) => {
  const tab = strings.tabs.find((item) => item.id === id);
  if (!tab) throw new Error(`no tab ${id}`);
  return tab;
};

describe('GuidePage', () => {
  beforeAll(() => {
    // jsdom has no layout, so no scrollIntoView; the pager calls it.
    Element.prototype.scrollIntoView = vi.fn();
  });

  it('has one h1, a tab per topic with the first one open, and sets the tab title', async () => {
    renderGuide();
    expect(await screen.findByRole('heading', { level: 1, name: strings.title })).toBeVisible();
    expect(document.title).toBe('Documentation · nthstock');

    const list = screen.getByRole('tablist', { name: strings.tabsLabel });
    const tabs = within(list).getAllByRole('tab');
    expect(tabs.map((tab) => tab.textContent)).toEqual(strings.tabs.map((tab) => tab.label));
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    const panel = screen.getByRole('tabpanel');
    expect(
      within(panel).getByRole('heading', { level: 2, name: strings.tabs[0].title }),
    ).toBeVisible();
  });

  it('opens the tab the link names, and the first one for an unknown name', async () => {
    renderGuide('scalability');
    expect(
      await screen.findByRole('heading', { level: 2, name: tabOf('scalability').title }),
    ).toBeVisible();
    expect(screen.getByRole('tab', { name: 'Scalability' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(document.title).toBe('Scalability · Documentation · nthstock');
  });

  it('falls back to the overview for a tab that does not exist', async () => {
    renderGuide('no-such-tab');
    expect(
      await screen.findByRole('heading', { level: 2, name: strings.tabs[0].title }),
    ).toBeVisible();
  });

  it('switches topics from the tab list and from the pager, and reports each choice', async () => {
    const user = userEvent.setup();
    const { onSelectTab } = renderGuide();
    await user.click(await screen.findByRole('tab', { name: 'AI agent team' }));
    expect(onSelectTab).toHaveBeenLastCalledWith('agents');
    expect(screen.getByRole('heading', { level: 2, name: tabOf('agents').title })).toBeVisible();

    const pager = screen.getByRole('navigation', { name: strings.pagerLabel });
    await user.click(within(pager).getByRole('button', { name: /Next: Roadmap/ }));
    expect(onSelectTab).toHaveBeenLastCalledWith('roadmap');
    const heading = screen.getByRole('heading', { level: 2, name: tabOf('roadmap').title });
    await vi.waitFor(() => expect(heading).toHaveFocus());
    // The last topic has no Next button.
    expect(
      within(screen.getByRole('navigation', { name: strings.pagerLabel })).queryByRole('button', {
        name: /Next/,
      }),
    ).toBeNull();
  });

  it('renders every topic, with its diagrams as labelled images and a text version', async () => {
    const user = userEvent.setup();
    renderGuide();
    for (const tab of strings.tabs) {
      await user.click(await screen.findByRole('tab', { name: tab.label }));
      const panel = screen.getByRole('tabpanel');
      expect(within(panel).getByRole('heading', { level: 2, name: tab.title })).toBeVisible();
      const diagrams = tab.blocks.filter((block) => block.kind === 'diagram');
      expect(within(panel).queryAllByRole('img')).toHaveLength(diagrams.length);
      expect(within(panel).queryAllByText(strings.inWords)).toHaveLength(diagrams.length);
    }
  });

  it('shows the demo login and links to the login page', async () => {
    renderGuide('demo');
    expect(await screen.findByText('9000000001')).toBeVisible();
    expect(screen.getByText('123456')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Go to login' })).toHaveAttribute('href', '/login');
  });

  it('opens every code link on GitHub in a new tab safely', async () => {
    renderGuide('architecture');
    const panel = await screen.findByRole('tabpanel');
    const links = within(panel)
      .getAllByRole('link')
      .filter((link) => link.getAttribute('target') === '_blank');
    expect(links.length).toBeGreaterThan(2);
    for (const link of links) {
      expect(link.getAttribute('href')).toMatch(
        /^https:\/\/github\.com\/nareshpayani\/nthstock\/blob\/develop\//,
      );
      expect(link).toHaveAttribute('rel', 'noopener noreferrer');
      expect(link).toHaveAccessibleName(/opens in a new tab/);
    }
  });

  it('lists a labelled player with poster, mp4 and captions for every walkthrough clip', async () => {
    renderGuide('walkthroughs');
    const panel = await screen.findByRole('tabpanel');
    const block = tabOf('walkthroughs').blocks.find((item) => item.kind === 'videos');
    if (block?.kind !== 'videos') throw new Error('walkthroughs tab has no videos block');
    expect(block.items.length).toBeGreaterThan(0);

    const players = panel.querySelectorAll('video');
    expect(players).toHaveLength(block.items.length);
    for (const video of block.items) {
      const player = within(panel).getByLabelText(
        `${video.title}, ${video.device.toLowerCase()} walkthrough video`,
      );
      expect(player.tagName).toBe('VIDEO');
      expect(player).toHaveAttribute('poster', videoFile(video.id, 'jpg'));
      expect(player).toHaveAttribute('preload', 'none');
      expect(player.querySelector('source')).toHaveAttribute('src', videoFile(video.id, 'mp4'));
      expect(player.querySelector('source')).toHaveAttribute('type', 'video/mp4');
      const track = player.querySelector('track');
      expect(track).toHaveAttribute('kind', 'captions');
      expect(track).toHaveAttribute('src', videoFile(video.id, 'vtt'));
    }
  });

  it('names Claude Code on the AI agent tab', async () => {
    renderGuide('agents');
    const panel = await screen.findByRole('tabpanel');
    expect(within(panel).getAllByText(/Claude Code/).length).toBeGreaterThan(0);
  });
});
