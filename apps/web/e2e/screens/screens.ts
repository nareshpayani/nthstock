// The screens captured for the before/after screenshots on UI pull requests (NSTOCK-0285,
// docs/runbooks/pr-screenshots.md). A new route or a new state worth reviewing gets a line here, so
// PRs that change it show it. Names are file names: camelCase, unique.

export type Screen = {
  /** File name and label in the PR, e.g. `stockDetail`. */
  name: string;
  /** Path to open. */
  path: string;
  /** Needs the demo user logged in (routes under `_authed`). */
  authed: boolean;
};

export const SCREENS: readonly Screen[] = [
  { name: 'login', path: '/login', authed: false },
  { name: 'dashboard', path: '/dashboard', authed: false },
  { name: 'stockDetail', path: '/stocks/INFY', authed: false },
  { name: 'indexDetail', path: '/stocks/NIFTY50?exchange=NSE', authed: false },
  { name: 'guide', path: '/guide', authed: false },
  { name: 'guideDemoTwo', path: '/guide?tab=demo-two', authed: false },
  { name: 'guideWalkthroughs', path: '/guide?tab=walkthroughs', authed: false },
  { name: 'guideArchitecture', path: '/guide?tab=architecture', authed: false },
  { name: 'guideScalability', path: '/guide?tab=scalability', authed: false },
  { name: 'portfolio', path: '/portfolio', authed: true },
  { name: 'positions', path: '/positions', authed: true },
  { name: 'orders', path: '/orders', authed: true },
  { name: 'funds', path: '/funds', authed: true },
  { name: 'security', path: '/settings/security', authed: true },
];

export const VIEWPORTS = [
  { label: 'desktop', width: 1440, height: 900 },
  { label: 'mobile', width: 390, height: 844 },
] as const;
