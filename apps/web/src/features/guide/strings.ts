/**
 * UI copy for the reviewer guide (NSTOCK-0280): what nthstock is, what v1 does, how to place a
 * paper trade, how it is built and how to run it. Keep it in step with docs/product.md §2 and
 * docs/runbooks/local-demo.md when features or commands change.
 */
export const strings = {
  pageTitle: 'Guide',
  title: 'nthstock guide',
  description:
    'A short tour for reviewers: what the app does, how to place a paper trade, and how it is built.',
  tocLabel: 'On this page',

  intro: {
    title: 'What nthstock is',
    body: [
      'nthstock is an Indian stock-market investing and paper-trading platform. You can follow NSE and BSE stocks and indices with live prices, keep watchlists, and buy and sell with ₹10,00,000 of virtual cash.',
      'It is paper trading only. No real money moves, no orders reach an exchange, and all prices come from a simulated market feed, not from NSE or BSE.',
    ],
  },

  tryIt: {
    title: 'Try it in two minutes',
    steps: [
      'Open the demo link with ?demo=1 at the end, for example nthstock-a13a5.web.app/dashboard?demo=1. It loads a ready-made account with watchlists and holdings.',
      'Click Log in, enter mobile number 9000000001, tick the consent box and choose Get OTP.',
      'Enter the OTP 123456. It is a demo code and works only on the demo site.',
      'On the PIN step, choose Skip for now. You land on the dashboard, logged in as Demo Investor.',
    ],
    loginLabel: 'Demo login',
    login: [
      { term: 'Mobile number', value: '9000000001' },
      { term: 'OTP', value: '123456' },
      { term: 'Browser', value: 'Chrome, latest version' },
    ],
    note: 'The mock market stays open at any hour on the demo site. Each browser tab keeps its own state, and opening a page with ?demo=1 resets it.',
    cta: 'Go to login',
  },

  features: {
    title: 'Features in this version',
    list: [
      {
        name: 'Dashboard',
        body: 'NIFTY 50 chart with ranges from 1 day to 5 years, market indices, curated stock lists, and top gainers and losers by index.',
      },
      {
        name: 'Live prices',
        body: 'Prices update live over a WebSocket feed. Every up or down move shows ▲ or ▼ and a sign, not colour alone.',
      },
      {
        name: 'Search',
        body: 'Find any of about 5,000 NSE and BSE stocks by symbol or name. Press / anywhere to jump to search.',
      },
      {
        name: 'Watchlists',
        body: 'Several watchlists with live prices. Add from search, reorder, remove, and buy or sell straight from a row.',
      },
      {
        name: 'Stock detail',
        body: 'Area and candlestick charts, key stats (day and 52-week range, volume, market cap, P/E), live market depth and a company overview.',
      },
      {
        name: 'Order ticket',
        body: 'Buy or sell with delivery or intraday, market or limit orders, a review step before you confirm, and after-market orders (AMO) when the market is closed.',
      },
      {
        name: 'Orders',
        body: 'Open, executed and cancelled orders. Modify or cancel an open limit order. A toast tells you when an order fills.',
      },
      {
        name: 'Positions and portfolio',
        body: 'Today’s positions with live P&L and an Exit button. Delivery buys move to Portfolio after 3:30 PM IST, valued live.',
      },
      {
        name: 'Funds',
        body: '₹10,00,000 of virtual cash, a ledger of every block, debit and credit, and a reset to start over.',
      },
      {
        name: 'Accounts',
        body: 'Mobile number and OTP login, a 4-digit PIN for quick logins on a trusted browser, and consent under the DPDP Act 2023.',
      },
      {
        name: 'Keyboard and accessibility',
        body: 'Built to WCAG 2.2 AA. Press ? for shortcuts: / search, ↑ ↓ through the watchlist, B to buy and S to sell the focused stock.',
      },
      {
        name: 'Market rules',
        body: 'NSE hours (9:15 AM to 3:30 PM IST) and holidays are enforced. Intraday orders can be placed until 3:20 PM IST.',
      },
    ],
  },

  buy: {
    title: 'How to buy a stock',
    steps: [
      'Log in with the demo account (see Try it in two minutes).',
      'Search for a stock, for example INFY, using the search box in the left panel or by pressing /.',
      'Open the stock and choose Buy. You can also hover a watchlist row and choose B.',
      'In the order ticket, pick Delivery (keep it) or Intraday (close today), and Market or Limit. For a limit order, enter your price or pick one from market depth.',
      'Enter the quantity. The ticket shows the required amount and your available cash.',
      'Choose Buy, check the review, then choose Confirm. A market order fills at once and a toast shows the fill price.',
      'Find it under Orders (Executed), under Positions with live P&L, and under Portfolio after 3:30 PM IST. Funds shows the cash debited.',
    ],
  },

  sell: {
    title: 'How to sell a stock',
    steps: [
      'Open a stock you hold, for example RELIANCE from the demo holdings, and choose Sell. From a watchlist row, choose S.',
      'Pick Delivery to sell shares from your portfolio, or Intraday to close a position you opened today.',
      'Enter the quantity and the order type, choose Sell, review and Confirm.',
      'To close an intraday position in one step, go to Positions and choose Exit on its row.',
      'The sale shows under Orders, and the cash is credited in Funds.',
    ],
    note: 'An open limit order can be modified or cancelled from Orders until it fills.',
  },

  stack: {
    title: 'How it is built',
    groups: [
      {
        name: 'Web app',
        items: [
          'React 19 and TypeScript (strict), built with Vite as a single-page app',
          'TanStack Router for type-safe routes and TanStack Query for server data',
          'Zustand for small UI state, React Hook Form and Zod for forms',
          'Tailwind CSS on design tokens, own component library with Storybook',
          'Lightweight Charts for price charts, TanStack Virtual for long lists',
        ],
      },
      {
        name: 'Backend',
        items: [
          'Node.js 22 and Fastify as a modular monolith REST API (/v1)',
          'A separate WebSocket server for live quotes and order updates',
          'PostgreSQL 16 with Drizzle migrations and an append-only audit log',
          'Redis 7 for quotes, sessions, pub/sub and jobs',
        ],
      },
      {
        name: 'Market and trading',
        items: [
          'A seeded NSE and BSE symbol master with a random-walk price generator',
          'A paper trading engine for order matching, cash blocks and P&L',
          'Shared typed contracts, so every API and WebSocket message is checked',
          'Money is stored as whole paise, never as floating point',
        ],
      },
      {
        name: 'Quality and delivery',
        items: [
          'npm workspaces and Turborepo, ESLint and Prettier',
          'Vitest unit tests, Playwright end-to-end tests and axe accessibility checks',
          'Performance budgets: initial JS under 200 KB gzipped, LCP under 2 s',
          'GitHub Actions CI, CodeQL, and an AI agent team that plans, builds, reviews and fixes',
          'Firebase Hosting with a preview link for every change before it goes live',
        ],
      },
    ],
    demoNote:
      'The hosted demo runs entirely in your browser: Mock Service Worker answers the API and the live feed, so no server is needed.',
  },

  run: {
    title: 'Run it locally',
    body: 'You need Node.js 22 and Chrome. The source is public on GitHub.',
    repoLabel: 'Source code on GitHub',
    repoUrl: 'https://github.com/nareshpayani/nthstock',
    commands: [
      { label: 'Install', command: 'npm install' },
      {
        label: 'Web app on mocks, no servers (http://localhost:5173)',
        command: 'npm run dev -w @nthstock/web',
      },
      { label: 'Web, API and realtime (needs Docker)', command: 'npm run dev:api' },
      { label: 'Full quality gate', command: 'npm run check' },
      { label: 'End-to-end tests in Chrome', command: 'npm run e2e' },
      { label: 'Component library (http://localhost:6006)', command: 'npm run storybook' },
    ],
    demoHint: 'Add ?demo=1 to any local URL to load the demo account.',
  },

  limits: {
    title: 'Not in this version',
    list: [
      'Real money, real orders and real KYC, PAN or bank details',
      'Real-time exchange data (that needs an exchange licence)',
      'Mutual funds, IPOs, futures and options',
      'Mobile app, dark mode and languages other than English',
    ],
  },
} as const;
