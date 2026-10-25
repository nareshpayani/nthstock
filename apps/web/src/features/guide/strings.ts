import { defineTabs, repoLink } from './model/guideContent';

/**
 * UI copy for the reviewer guide (NSTOCK-0280, tabbed in NSTOCK-0341): from what nthstock is down
 * to the code, one tab per question a reviewer asks. Keep it in step with the docs it summarises:
 * docs/product.md, docs/architecture.md, docs/agent-workflow.md, WRITEUP.md and
 * docs/runbooks/load-test.md. Documentation may name the AI tools used (owner decision,
 * 2026-10-24).
 */
export const strings = {
  pageTitle: 'Documentation',
  title: 'nthstock documentation',
  description:
    'Everything about nthstock in one place, from what it does down to how each part is built, tested, scaled and shipped.',
  headerCta: 'Log in to start',
  tabsLabel: 'Documentation topics',
  previous: 'Previous',
  next: 'Next',
  inWords: 'The diagram in words',
  opensInNewTab: '(opens in a new tab)',
  pagerLabel: 'Previous and next topic',

  tabs: defineTabs([
    {
      id: 'overview',
      label: 'Overview',
      title: 'What nthstock is',
      summary: 'The product, who it is for, and what this version does and does not do.',
      blocks: [
        {
          kind: 'text',
          text: 'nthstock is an Indian stock-market investing and paper-trading platform. You follow NSE and BSE stocks and indices with live prices, keep watchlists, and buy and sell with ₹10,00,000 of virtual cash. Its layout follows the Paytm Money stocks dashboard, with nthstock’s own light theme, logo and components.',
        },
        {
          kind: 'text',
          text: 'It is paper trading only. No real money moves, no order reaches an exchange, and every price comes from a simulated market, not from NSE or BSE.',
        },
        {
          kind: 'facts',
          label: 'At a glance',
          items: [
            { term: 'Live demo', value: 'nthstock-a13a5.web.app' },
            { term: 'Source', value: 'github.com/nareshpayani/nthstock (public)' },
            {
              term: 'Instruments',
              value: 'About 5,000 NSE and BSE equities and the major indices',
            },
            { term: 'Virtual cash', value: '₹10,00,000 per account' },
            { term: 'Platforms', value: 'Desktop Chrome first; phones for Trade from Charts' },
            { term: 'Built', value: 'September to October 2026, in phases' },
          ],
        },
        { kind: 'heading', text: 'How to read this documentation' },
        {
          kind: 'text',
          text: 'The tabs go from high level to low level. Start with the demo and the features, then the architecture, then the design of each part, and finish with how it is tested, scaled and shipped. Every tab links to the code it describes.',
        },
        { kind: 'heading', text: 'Not in this version' },
        {
          kind: 'list',
          items: [
            'Real money, real orders, and real KYC, PAN or bank details',
            'Real-time exchange data (that needs an exchange licence)',
            'Mutual funds, IPOs, futures and options',
            'The mobile app, dark mode and languages other than English',
          ],
        },
        {
          kind: 'links',
          label: 'Read the code',
          items: [
            { label: 'Product scope (docs/product.md)', href: repoLink('docs/product.md') },
            { label: 'Project rules (CLAUDE.md)', href: repoLink('CLAUDE.md') },
            { label: 'Design rationale (WRITEUP.md)', href: repoLink('WRITEUP.md') },
          ],
        },
      ],
    },
    {
      id: 'demo',
      label: 'Try the demo',
      title: 'Try it in two minutes',
      summary: 'Log in to the hosted demo and place a paper trade.',
      blocks: [
        {
          kind: 'facts',
          label: 'Demo login',
          items: [
            { term: 'Mobile number', value: '9000000001' },
            { term: 'OTP', value: '123456' },
            { term: 'Browser', value: 'Chrome, or Safari on iPhone' },
          ],
        },
        { kind: 'heading', text: 'Log in' },
        {
          kind: 'steps',
          items: [
            'Open the login page and tap Try demo. It loads a ready-made account with watchlists and holdings.',
            'Or log in by hand: enter 9000000001, tick the consent box, choose Get OTP, and enter 123456. It is a demo code and works only on the demo site.',
            'On the PIN step, choose Skip for now. You land on the dashboard as Demo Investor.',
          ],
        },
        { kind: 'loginCta', label: 'Go to login' },
        { kind: 'heading', text: 'Buy a stock' },
        {
          kind: 'steps',
          items: [
            'Search for a stock, for example INFY, with the search box or by pressing /.',
            'Open it and choose Buy. On a watchlist row, B does the same.',
            'Pick Delivery or Intraday, and Market or Limit. For a limit order, enter a price or pick one from the market depth.',
            'Enter the quantity. The ticket shows the amount needed and your available cash.',
            'Choose Buy, check the review, and Confirm. A market order fills at once and a toast shows the price.',
            'See it under Orders, under Positions with live P&L, and in Funds as cash debited.',
          ],
        },
        { kind: 'heading', text: 'Sell, or trade from the chart' },
        {
          kind: 'steps',
          items: [
            'Open a stock you hold, for example RELIANCE from the demo holdings, and choose Sell. Or choose Exit on a row in Positions.',
            'On a phone, open a stock and tap the empty strip beside the price axis: a ghost line appears with Buy and Sell chips. Tap one to place an order at that price.',
            'Drag an order line’s handle to modify it. Tap your position chip to add a trailing stop.',
            'Switch on Scalp for the one-tap pad. Arm it first; it disarms itself after 2 minutes idle.',
            'Use the labelled Demo simulator on the instrument page to move the price, so a trailing stop ratchets and triggers in seconds.',
          ],
        },
        {
          kind: 'note',
          text: 'The demo market is always open, so orders fill at any hour. Each browser tab keeps its own account; opening a page with ?demo=1 resets it.',
        },
        { kind: 'heading', text: 'Run it on your machine' },
        {
          kind: 'code',
          label: 'Node.js 22 and npm',
          text: 'git clone https://github.com/nareshpayani/nthstock.git && cd nthstock\nnpm install\nnpm run dev -w @nthstock/web    # web app on mocks, http://localhost:5173\nnpm run dev:api                 # web + API + realtime on Postgres and Redis (Docker)\nnpm run check                   # format, lint, typecheck, tests, build\nnpm run e2e                     # Playwright end-to-end tests\nnpm run storybook               # component library, http://localhost:6006',
        },
      ],
    },
    {
      id: 'features',
      label: 'Features',
      title: 'Features in this version',
      summary: 'What a user can do, screen by screen.',
      blocks: [
        {
          kind: 'cards',
          items: [
            {
              name: 'Dashboard',
              body: 'NIFTY 50 chart from 1 day to 5 years, market indices, curated stock lists, and top gainers and losers by index.',
            },
            {
              name: 'Live prices',
              body: 'Prices update live over a WebSocket. Every move shows ▲ or ▼ and a sign, never colour alone.',
            },
            {
              name: 'Search',
              body: 'About 5,000 NSE and BSE stocks by symbol or name. Press / anywhere.',
            },
            {
              name: 'Watchlists',
              body: 'Several lists with live prices. Add from search, reorder, remove, and trade from a row.',
            },
            {
              name: 'Stock detail',
              body: 'Area and candle charts from 1 day to 5 years, with 1, 5, 15, 30 and 60-minute bars on intraday ranges, key stats, live market depth and a company overview.',
            },
            {
              name: 'Order ticket',
              body: 'Delivery or intraday, market or limit, a review step, after-market orders, and a full trailing stop-loss section.',
            },
            {
              name: 'Trade from Charts',
              body: 'Place, drag and cancel orders on the chart; a position line with live P&L; a trailing stop from the position chip.',
            },
            {
              name: 'Price alerts and notifications',
              body: 'A bell beside the star on any stock: set a level (quick ±1% and ±2%) and a note, see it as a dotted line on the chart, and get a toast the moment the price crosses it. A bell in the header counts unread alerts, fills and trailing stops.',
            },
            {
              name: 'Two-factor authentication',
              body: 'Settings, Security: scan a QR code into any authenticator app, confirm with its code and save ten one-time recovery codes. The next login asks for the code after the OTP or PIN; sensitive changes ask you to confirm it is you first.',
            },
            {
              name: 'Where you are logged in',
              body: 'Settings, Security lists every browser and phone with a session, with This device and Trusted badges and IST times. Log out one, or all the others, behind a confirm and a step-up; the logged-out device is refused at once.',
            },
            {
              name: 'Your data, your call (DPDP Act)',
              body: 'Sign-up records which version of the terms and privacy notice you agreed to. Settings, Security deletes the account behind DELETE typed and a step-up: every device is logged out at once, live orders are cancelled, and the mobile cannot log in until the data is erased for good 30 days later.',
            },
            {
              name: 'Scalper',
              body: 'A one-tap pad: quantity chips, Sell at bid, Buy at ask, Flatten and Reverse, with an Arm switch.',
            },
            {
              name: 'Orders, positions, portfolio',
              body: 'Open, executed and cancelled orders; positions with live P&L and Exit; holdings valued live.',
            },
            {
              name: 'Funds',
              body: '₹10,00,000 of virtual cash, a ledger of every block, debit and credit, and a reset.',
            },
            {
              name: 'Accounts',
              body: 'Mobile and OTP login, a 4-digit PIN on a trusted browser, and DPDP Act consent at sign-up.',
            },
            {
              name: 'Keyboard and accessibility',
              body: 'WCAG 2.2 AA. Press ? for shortcuts: / search, ↑ ↓ through a watchlist, B buy, S sell.',
            },
            {
              name: 'Market rules',
              body: 'NSE hours (9:15 AM to 3:30 PM IST) and holidays, tick size of 5 paise, ±20% circuit bands, intraday cut-off at 3:20 PM.',
            },
            {
              name: 'Documentation',
              body: 'This page: public, deep-linkable tabs, also linked from the login page.',
            },
          ],
        },
      ],
    },
    {
      id: 'trade-from-charts',
      label: 'Trade from Charts',
      title: 'Trade from Charts, trailing stop-loss and Scalper',
      summary:
        'The Paytm Money assignment: how the chart, the trailing stop engine and the scalper pad work.',
      blocks: [
        {
          kind: 'text',
          text: 'The assignment asked for three things on a phone: trading straight from the chart, a trailing stop-loss order (TSLO), and a one-tap scalper. All three share one trading engine and one source of truth, so the chart, ticket, depth, orders and positions never disagree.',
        },
        { kind: 'heading', text: 'Gestures: zones decide, not timing' },
        {
          kind: 'table',
          caption: 'Chart gestures on a phone',
          head: ['Gesture', 'Where', 'What happens'],
          rows: [
            ['Drag sideways, pinch', 'Plot', 'Pan and zoom time; a vertical drag scrolls the page'],
            ['Long-press', 'Plot', 'Crosshair; it never trades'],
            [
              'Tap',
              'Empty price-axis strip',
              'A ghost line with Buy and Sell chips; nothing is sent yet',
            ],
            ['Drag', 'A line’s 44 px handle', 'Moves that order or stop; the chart does not pan'],
            ['Tap', 'Position chip', 'Opens the trailing-stop sheet'],
            ['Two taps within 3 s', '× on a handle', 'Cancels the order'],
          ],
        },
        {
          kind: 'text',
          text: 'A drag shows the new price on every surface as the finger moves, but sends one modify, on release. A modify per frame could fill the order at a price the finger only passed through.',
        },
        { kind: 'heading', text: 'The trailing stop engine' },
        {
          kind: 'text',
          text: 'The trailing logic lives in one pure function, stepTrailingStop(state, tick), in the shared paper engine. It runs on every tick of the instrument, in the same step as order matching. For a long position the high-water mark is max(mark, LTP) and the stop is max(stop, mark − trail) rounded down to the 5-paise tick, so it never moves back. At LTP ≤ stop it places one reduce-only exit.',
        },
        {
          kind: 'text',
          text: 'The same engine runs on the server (NSTOCK-0368). In api mode apps/api keeps every stop in a Postgres trailing_stops table, beside the account’s engine seq and its exit orders, so a stop keeps ratcheting after a restart and a retried place with the same key answers with the same stop. Each committed change goes out on the user’s Redis channel, and apps/realtime sends it to that user’s tabs as an accountDelta frame, the same frame the in-browser demo sends. The ticket, chart line and sheet work the same in both modes.',
        },
        { kind: 'diagram', id: 'tslo' },
        {
          kind: 'table',
          caption: 'Edge cases and how they are handled',
          head: ['Case', 'Behaviour'],
          rows: [
            [
              'Gap through the stop',
              'The trigger compares “at or through”, so a gap still triggers, once, at the gap price',
            ],
            [
              'Position closed another way',
              'Any fill that flattens or flips the position cancels the stop in the same step',
            ],
            [
              'Phone paused the tab',
              'Missed ticks are replayed in order, with their timestamps, up to 30 minutes, in under 100 ms',
            ],
            ['Partial fills', 'The protected quantity follows the open quantity after every fill'],
            [
              'Invalid trail',
              'Zero, under ₹0.05, over 20% of price, or through the LTP is refused with a plain message',
            ],
          ],
        },
        { kind: 'heading', text: 'Scalper: fast and safe' },
        {
          kind: 'list',
          items: [
            'Buy and Sell send an immediate-or-cancel limit at the price on the button, taken from the same frame’s depth, so the user knows the price they tap.',
            'An Arm switch: disarmed, the buttons send nothing. It disarms after 2 minutes without a trade, when the page is hidden, or when the instrument changes.',
            'Only Reverse, which doubles exposure, needs a 400 ms hold. No confirmation dialogs.',
            'Every tap gets an acknowledgement such as “Bought 5 @ ₹1,234.55”, “Partly filled” or “Not filled”.',
          ],
        },
        {
          kind: 'links',
          label: 'Read the code',
          items: [
            {
              label: 'Trailing stop engine',
              href: repoLink('packages/paperEngine/src/trailingStop.ts'),
            },
            {
              label: 'Chart trading feature',
              href: repoLink('apps/web/src/features/chartTrading'),
            },
            { label: 'Scalper feature', href: repoLink('apps/web/src/features/scalper') },
            {
              label: 'Specification SPEC-TFC-1',
              href: repoLink('docs/specs/trade-from-charts.md'),
            },
            {
              label: 'Requirements matrix',
              href: repoLink('docs/specs/trade-from-charts-traceability.md'),
            },
          ],
        },
      ],
    },
    {
      id: 'architecture',
      label: 'Architecture',
      title: 'Architecture: how the app works',
      summary: 'The parts, what each one owns, and how a price and an order travel between them.',
      blocks: [
        { kind: 'diagram', id: 'system' },
        { kind: 'heading', text: 'The parts' },
        {
          kind: 'table',
          caption: 'What each part owns',
          head: ['Part', 'Owns', 'Built with'],
          rows: [
            [
              'apps/web',
              'Every screen; the live quote store and the trading store',
              'React 19, Vite, TanStack Router and Query',
            ],
            [
              'apps/api',
              'REST under /v1: auth, users, watchlists, orders, portfolio, funds, market, audit',
              'Fastify 5 modular monolith',
            ],
            [
              'apps/realtime',
              'WebSocket fan-out of quotes and per-user order updates',
              'Node ws server, scales on its own',
            ],
            [
              'packages/marketData',
              'The mock market: symbol master, ticks, candles, depth',
              'Pure TypeScript, runs in Node and the browser',
            ],
            [
              'packages/paperEngine',
              'Orders, fills, funds ledger, positions, P&L, trailing stops',
              'Pure TypeScript, one engine for both modes',
            ],
            [
              'packages/contracts',
              'Every REST and WS message, as Zod schemas',
              'Zod 4; types and runtime checks',
            ],
            [
              'PostgreSQL 16',
              'Users, sessions, orders, ledger, holdings, audit log',
              'Drizzle migrations, three roles',
            ],
            ['Redis 7', 'Tick and order pub/sub, OTPs, session revocation, rate limits', 'ioredis'],
          ],
        },
        { kind: 'heading', text: 'Two ways to run' },
        {
          kind: 'list',
          items: [
            'Hosted demo (what you are using): the whole backend runs in your browser. Mock Service Worker answers the same REST and WebSocket contracts, with the same market and paper engine packages. So the demo needs no server and costs nothing to host.',
            'Full stack (npm run dev:api): the SPA talks to apps/api and apps/realtime on PostgreSQL and Redis. This is the mode the load test measures.',
          ],
        },
        { kind: 'heading', text: 'A price, from tick to screen' },
        {
          kind: 'steps',
          items: [
            'The mock market steps each instrument’s price (every second, or every 250 ms for the one on screen).',
            'apps/api’s tick pump publishes each batch to Redis.',
            'apps/realtime keeps only what each socket subscribed to, conflates it to at most 4 updates a second per symbol, and sends compact binary frames.',
            'The browser’s quote store updates only the cells for that symbol, batched into one paint per animation frame.',
          ],
        },
        { kind: 'heading', text: 'An order, from tap to fill' },
        {
          kind: 'steps',
          items: [
            'The ticket validates the order with the same Zod schema the server uses, then sends POST /v1/orders with an idempotency key.',
            'The orders module checks the funds, and the paper engine fills a market order at the current price, or keeps a limit order open until the price reaches it.',
            'The fill commits the order, its events, the funds ledger, the position and the audit entries in one Postgres transaction.',
            'The engine in memory is only a cache of the account in Postgres. Each change commits against the version it was read at, so a second writer is caught, reloads and retries once. At boot apps/api loads every account with a resting order, so a limit order placed before a restart still fills on the tick that crosses it.',
            'The order update goes out over Redis and the WebSocket, and every screen updates from it.',
          ],
        },
        { kind: 'heading', text: 'Matching off the API process (being built)' },
        {
          kind: 'steps',
          items: [
            'apps/matcher runs one process per shard of instruments. A Redis lease picks the one that acts; the others follow the same streams, so a standby is current the moment it takes over.',
            'After each order commit, apps/api appends an ADD, MODIFY or CANCEL command to the shard’s command stream, stamped with the account version. A late or replayed command never undoes a newer one.',
            'Each instrument has an order book: limit orders and trailing stops sit in price heaps, so a tick reads only what it fills, triggers or moves, not every resting order. A property test checks it against a full walk.',
            'Every minute, and on start, the matcher reads its shard’s live orders from Postgres, the record, and repairs its books, so a lost command is fixed within a minute.',
            'Still to come: fills committed through the account store, server-side trailing stops, a switch to turn it on, and a benchmark.',
          ],
        },
        {
          kind: 'links',
          label: 'Read the code',
          items: [
            {
              label: 'Architecture (docs/architecture.md)',
              href: repoLink('docs/architecture.md'),
            },
            { label: 'Decision records (docs/adr)', href: repoLink('docs/adr') },
            { label: 'API app (apps/api/src/app.ts)', href: repoLink('apps/api/src/app.ts') },
            { label: 'Realtime hub', href: repoLink('apps/realtime/src/connections/hub.ts') },
          ],
        },
      ],
    },
    {
      id: 'low-level-design',
      label: 'Low-level design',
      title: 'Low-level design',
      summary: 'The patterns inside each layer: modules, stores, contracts, money and time.',
      blocks: [
        { kind: 'heading', text: 'Architecture patterns' },
        {
          kind: 'table',
          caption: 'Patterns and where they are used',
          head: ['Pattern', 'Where', 'Why'],
          rows: [
            [
              'Modular monolith',
              'apps/api/src/modules/<module>',
              'One deployable, clear module seams; a module is imported only through its index.ts',
            ],
            [
              'Repository, two drivers',
              'repo.ts (memory) and pgRepo.ts (Postgres)',
              'Fast unit tests in memory; the same tests prove the Postgres repo',
            ],
            [
              'Adapter',
              'packages/marketData MarketDataAdapter',
              'A licensed vendor or broker feed can replace the mock without touching callers',
            ],
            [
              'Contract first',
              'packages/contracts',
              'One Zod schema types the client, validates the server and drives the mocks',
            ],
            [
              'Pure engine, state machine',
              'packages/paperEngine',
              'Order and stop rules are deterministic and testable without I/O',
            ],
            [
              'Single writer, event sequence',
              'Engine seq and accountDelta frames',
              'Clients drop stale frames and re-read on a gap, so no older copy replaces a newer one',
            ],
            [
              'Pub/sub fan-out',
              'Redis to apps/realtime',
              'API and socket servers scale separately',
            ],
            [
              'Feature-sliced UI',
              'apps/web routes → features → shared → packages',
              'Lint-enforced import direction; features never import each other’s internals',
            ],
            [
              'External store',
              'Quote store and trading store',
              'Ticks bypass React render; one commit per frame',
            ],
          ],
        },
        { kind: 'heading', text: 'Inside an API module' },
        {
          kind: 'code',
          label: 'apps/api/src/modules/orders',
          text: 'index.ts     public surface of the module\nroutes.ts    Fastify routes, typed from the contracts route map\nservice.ts   business rules; calls the paper engine\nrepo.ts      repository interface + in-memory driver\npgRepo.ts    Postgres driver (Drizzle), one transaction per change\nschema.ts    request and response schemas',
        },
        { kind: 'heading', text: 'Inside a web feature' },
        {
          kind: 'code',
          label: 'apps/web/src/features/<feature>',
          text: 'index.ts     the only import surface\nstrings.ts   every UI string\napi/         query keys, queries, mutations\ncomponents/  PascalCase .tsx with tests beside them\nhooks/       useX.ts\nmodel/       pure logic and types\nstore/       Zustand slice, only when needed',
        },
        { kind: 'heading', text: 'The trading store' },
        {
          kind: 'list',
          items: [
            'Framework-free, in packages/apiClient, so the future React Native app can reuse it.',
            'Applies each accountDelta frame in one commit, in the same animation frame as its quotes.',
            'Drops stale sequence numbers and re-reads the account after a gap or a reconnect.',
            'Writes through to the TanStack Query caches, so the orders and positions pages agree with the chart.',
            'Tracks pending intents (place, modify, cancel, close) until a response or a frame covers them, which is how a dragged line shows “Updating…” at its new price.',
          ],
        },
        { kind: 'heading', text: 'Price alerts and notifications' },
        {
          kind: 'list',
          items: [
            'AlertDesk in packages/paperEngine runs in both backends, beside the paper desk on the same market: it subscribes to an instrument only while some user has an active alert on it.',
            'Every tick is checked: an ABOVE alert fires on the first LTP at or above its level, a BELOW alert at or below, once. A gap past the level fires with the LTP that crossed it. A level the price has already passed is refused, so nothing fires on the tick it was set.',
            'A fired alert, an executed order and a triggered trailing stop each add a notification (the newest 100 are kept, with a read flag) and go to the owner at once as a notification message on the socket.',
            'The web app toasts a fired alert on any page, refreshes the bell and the alerts list, and draws active alerts as dotted price lines on the chart. Routes: GET and POST /v1/alerts, DELETE /v1/alerts/:id, GET /v1/notifications, POST /v1/notifications/read.',
          ],
        },
        { kind: 'heading', text: 'Two-factor authentication and step-up' },
        {
          kind: 'list',
          items: [
            'TOTP is RFC 6238 (6 digits, 30 s step, one step of clock drift either side) in packages/utils on Web Crypto, so the API and the in-browser mock compute the same codes with no library. The QR code is one SVG path; the qrcode library loads only on the Security page.',
            'The secret is stored encrypted per user, and the last step used is kept so a code cannot be replayed. Ten recovery codes are stored only as hashes, shown once, and each works once.',
            'A login for a user with two-factor on stops after the OTP or PIN with a 5-minute challenge; the code or a recovery code finishes it. Five wrong codes end the challenge.',
            'Sensitive routes answer 403 STEP_UP_REQUIRED until the session re-proves the user (PIN, or a step-up OTP that can never log anyone in, plus the code when two-factor is on) for 10 minutes. One shared dialog asks and retries the action. Every change is in the audit log.',
          ],
        },
        { kind: 'heading', text: 'Active sessions' },
        {
          kind: 'list',
          items: [
            'GET /v1/auth/sessions lists live sessions, most recently active first, with a device label made from the user agent (never the raw string) and no IP address.',
            'Logging out one session or all the others needs a step-up. Each revoke marks the row, writes the audit entry and publishes auth:sessionRevoked, so the device is refused on its next request and its sockets close.',
            'Turning two-factor on or off offers to log out the other devices, which still hold sessions from before the change.',
          ],
        },
        { kind: 'heading', text: 'Consent and account deletion (DPDP Act 2023)' },
        {
          kind: 'list',
          items: [
            'The first OTP login sends consentVersion, the policy version the user ticked. The API refuses a sign-up without the current version (400 CONSENT_REQUIRED) and writes the user and a consents row in one transaction, then audits CONSENT_GRANTED.',
            'POST /v1/account/deletion needs a step-up and confirm: DELETE. The user is marked deleted first, so no login can start a new session; then every session is revoked with reason ACCOUNT_DELETED (tokens refused, sockets closed), OPEN and AMO paper orders are cancelled, and ACCOUNT_DELETION_REQUESTED is audited with the purge date.',
            'For 30 days an OTP login for that mobile answers 403 ACCOUNT_DELETED with purgeAfter, and the login page says, in IST, when the data is erased. The purge job (a BullMQ job, with the other Phase 2 jobs) then erases the PII and leaves a tombstone; audit entries never held a mobile or a name.',
            'The web app navigates to /login?deleted=… before it clears the session, forgets the trusted browser and empties the query cache, so nothing from the account stays on the device.',
          ],
        },
        { kind: 'heading', text: 'OpenAPI 3.1, generated from the contracts' },
        {
          kind: 'list',
          items: [
            'packages/contracts builds an OpenAPI 3.1 document from the same route map that types the client, validates the server and drives the mocks, using Zod 4’s own z.toJSONSchema. Nothing is written by hand and no extra library is needed.',
            'Every route appears once with its method, path, path and query parameters, request body, response schema, its auth (cookie or Bearer JWT) and the ApiError envelope for every error. Response types are shared component schemas, so Order is described once.',
            'apps/api serves it at GET /v1/docs/openapi.json, public and cacheable for an hour with an ETag. npm run openapi writes the same text to docs/api/openapi.json, ready for Postman, Swagger Editor or a client generator.',
            'CI regenerates the file on every pull request, uploads it as a build artifact and fails when the committed copy is stale, so the published API description can never drift from the code. A new route joins automatically.',
          ],
        },
        { kind: 'heading', text: 'Rules every layer follows' },
        {
          kind: 'list',
          items: [
            'Money is integer paise (the Paise type), never a float. ₹1,234.55 is 123455.',
            'Time is stored in UTC and shown in IST.',
            'Every API and WebSocket message is typed and validated from packages/contracts.',
            'TypeScript strict; no any without a comment saying why.',
            'Quotes on the wire are 24-byte binary records with a 12-byte header; control messages stay JSON.',
          ],
        },
        {
          kind: 'links',
          label: 'Read the code',
          items: [
            {
              label: 'ADR 0005: web UI architecture',
              href: repoLink('docs/adr/0005-web-ui-architecture.md'),
            },
            {
              label: 'ADR 0012: one trading state',
              href: repoLink('docs/adr/0012-trading-state-and-chart-gestures.md'),
            },
            { label: 'Trading store', href: repoLink('packages/apiClient/src/tradingStore.ts') },
            { label: 'Binary quote frame', href: repoLink('packages/contracts/src/quoteFrame.ts') },
            { label: 'OpenAPI document', href: repoLink('docs/api/openapi.json') },
            { label: 'OpenAPI generator', href: repoLink('packages/contracts/src/openapi.ts') },
          ],
        },
      ],
    },
    {
      id: 'market-data',
      label: 'Mock market data',
      title: 'Mock market data and live ticks',
      summary: 'What data is simulated, how a realistic price is generated, and how it streams.',
      blocks: [
        {
          kind: 'text',
          text: 'Real NSE and BSE data needs an exchange licence, and scraped prices are ruled out. So nthstock simulates a market that behaves like one, behind an adapter interface a licensed feed can replace later.',
        },
        { kind: 'heading', text: 'What is simulated' },
        {
          kind: 'list',
          items: [
            'A symbol master of 5,000 equities plus the major indices, generated from a fixed seed (20260925), so every run has the same companies, sectors and market caps. Real large caps such as RELIANCE and TCS keep their names.',
            'Company names, profiles and fundamentals from @faker-js/faker, also seeded.',
            'Prices from a geometric Brownian motion (GBM) per instrument, with drift and volatility by sector, for example Financial Services 12% and 28%, FMCG 9% and 18%.',
            'Index levels computed from their constituents, candles from 1 minute to 5 years, five levels of market depth, curated lists and movers.',
            'Bar sizes: the API groups a range’s own bars into 1, 5, 15, 30 or 60-minute, daily or weekly bars (GET /v1/market/instruments/:symbol/candles?range=1D&interval=15m). Intraday bars are counted from the 9:15 open, as NSE charts do, so hourly bars open at 9:15, 10:15 and so on; live ticks extend the current bar of the chosen size.',
            'NSE rules: the 9:15 AM to 3:30 PM session and holidays, 5-paise ticks and ±20% circuit bands.',
          ],
        },
        { kind: 'heading', text: 'How a tick is made' },
        {
          kind: 'code',
          label: 'One GBM step (packages/marketData/src/ticks.ts)',
          text: 'next = price × exp((μ − σ²/2)·Δt + σ·√Δt·z)\n\nμ, σ  annual drift and volatility of the sector\nΔt    the tick interval in trading years\nz     a standard normal draw from the instrument’s own seeded stream\n\nThen: round to the 5-paise tick, clamp to the circuit band,\nupdate high, low and volume, and build the 1-minute bar.',
        },
        { kind: 'diagram', id: 'ticks' },
        { kind: 'heading', text: 'Details that make it feel real' },
        {
          kind: 'list',
          items: [
            'Two lanes: the instrument on screen ticks every 250 ms, the rest every second, and only while someone is subscribed.',
            'Each instrument has its own random stream, so one can advance without the others.',
            'After a phone pauses the tab, instruments with working orders or stops replay every missed tick, in order, up to 30 minutes; the rest move in one exact step.',
            'The Demo simulator can nudge or gap one instrument’s real feed, so every screen sees the same move.',
          ],
        },
        { kind: 'heading', text: 'Stored candles on TimescaleDB' },
        {
          kind: 'text',
          text: 'On the full stack, chart bars are stored, not made up on request: the 1-minute bar a user watched form is the bar the chart shows after a reload, and a year of daily bars is one indexed read.',
        },
        {
          kind: 'list',
          items: [
            'candles_1m is a TimescaleDB hypertable (one row per instrument and minute, prices in paise) in 1-day chunks, compressed by instrument after 7 days.',
            'Continuous aggregates build 5, 15, 30 and 60-minute and daily bars from it with time_bucket counted from 09:15 IST, so a 15-minute bar opens at 09:15, 09:30 and so on and a daily bar is one NSE session. Real-time aggregation adds the minutes not yet materialised, so a read always includes every closed minute.',
            'The candle writer reads the tick streams in its own Redis consumer group, keeps the forming bar of every instrument in memory, and writes each closed minute in one multi-row upsert. It acknowledges a minute only after it is stored, so a restart re-reads from there: no minute is lost and none is counted twice.',
            'A seed writes 2 years of daily history and 30 days of 1-minute bars from the same deterministic generator, so charts have depth on day one and every machine stores the same rows.',
            'GET /v1/market/instruments/:symbol/candles keeps its contract: 1-minute bars come from the hypertable, 5 minutes to 1 hour and daily from the aggregates, weekly from the daily bars, and the forming bar is finished with the live price from the quote service.',
          ],
        },
        {
          kind: 'links',
          label: 'Read the code',
          items: [
            { label: 'Mock adapter', href: repoLink('packages/marketData/src/mockAdapter.ts') },
            { label: 'GBM ticks', href: repoLink('packages/marketData/src/ticks.ts') },
            {
              label: 'Sector drift and volatility',
              href: repoLink('packages/marketData/src/sectors.ts'),
            },
            { label: 'Symbol master', href: repoLink('packages/marketData/src/symbolMaster.ts') },
            {
              label: 'Candle store migration',
              href: repoLink('apps/api/drizzle/0014_timescaledb_candles.sql'),
            },
            { label: 'Candle store and writer', href: repoLink('apps/api/src/modules/candles') },
            {
              label: 'ADR 0004: mock backend',
              href: repoLink('docs/adr/0004-mock-backend-and-paper-engine.md'),
            },
          ],
        },
      ],
    },
    {
      id: 'tech-stack',
      label: 'Tech stack',
      title: 'Technologies used',
      summary: 'Every main library and service, and why it was chosen.',
      blocks: [
        {
          kind: 'table',
          caption: 'Web app',
          head: ['Technology', 'Used for'],
          rows: [
            ['React 19, TypeScript strict', 'The UI'],
            ['Vite 8', 'Dev server and production build, one lazy chunk per route'],
            ['TanStack Router', 'Type-safe file routes and URL state'],
            ['TanStack Query', 'Server data, caching, background refresh'],
            ['Zustand', 'Small UI state'],
            ['Tailwind CSS 4 on design tokens', 'Styling; no raw colours outside packages/tokens'],
            ['Radix UI', 'Accessible primitives: dialogs, sheets, tabs, menus'],
            ['Lightweight Charts 5', 'Price charts, lazy-loaded'],
            ['React Hook Form and Zod', 'Forms and validation'],
            ['TanStack Virtual', 'Long lists'],
            ['Mock Service Worker', 'The in-browser backend of the hosted demo'],
          ],
        },
        {
          kind: 'table',
          caption: 'Backend and data',
          head: ['Technology', 'Used for'],
          rows: [
            ['Node.js 22 LTS', 'Runtime for both servers'],
            ['Fastify 5', 'REST API with per-route schemas and rate limits'],
            ['ws', 'The WebSocket server'],
            ['PostgreSQL 16 and Drizzle ORM', 'System of record and migrations'],
            ['TimescaleDB 2.17', 'Stored candles: a 1-minute hypertable and continuous aggregates'],
            ['Redis 7 and ioredis', 'Pub/sub, OTPs, revocation, rate limits'],
            ['jose', 'Signed 15-minute access tokens'],
            ['Argon2id', 'PIN hashing'],
          ],
        },
        {
          kind: 'table',
          caption: 'Quality, delivery and AI',
          head: ['Technology', 'Used for'],
          rows: [
            ['npm workspaces and Turborepo', 'Monorepo builds with caching'],
            ['ESLint and Prettier', 'Lint and format, enforced in CI'],
            ['Vitest and Testing Library', 'Unit and component tests'],
            ['Playwright and axe', 'End-to-end, phone, performance and accessibility tests'],
            ['Storybook', 'The component library and design source'],
            [
              'GitHub Actions, CodeQL, gitleaks, Dependabot',
              'CI, security scans, dependency updates',
            ],
            ['Firebase Hosting', 'Preview, development and production sites'],
            ['Claude Code', 'The AI coding agent behind the specs, code and the agent team'],
          ],
        },
        {
          kind: 'links',
          label: 'Read the code',
          items: [
            { label: 'ADR 0002: core stack', href: repoLink('docs/adr/0002-core-stack.md') },
            { label: 'Web app package.json', href: repoLink('apps/web/package.json') },
            { label: 'API package.json', href: repoLink('apps/api/package.json') },
          ],
        },
      ],
    },
    {
      id: 'performance',
      label: 'Performance',
      title: 'Performance',
      summary: 'The targets, how each is enforced, and what was measured.',
      blocks: [
        {
          kind: 'table',
          caption: 'Targets (CLAUDE.md §3) and how they are checked',
          head: ['Target', 'Budget', 'Checked by'],
          rows: [
            [
              'Initial JavaScript',
              'under 200 KB gzipped',
              'checkBuild.mjs after every build; the build fails over budget',
            ],
            ['Self-hosted fonts', 'under 100 KB', 'checkBuild.mjs'],
            ['Largest contentful paint', 'under 2.0 s', 'Web vitals job in CI (Chrome)'],
            ['Interaction to next paint', 'under 150 ms', 'Web vitals job in CI'],
            ['Layout shift', 'under 0.05', 'Web vitals job in CI'],
            ['Tick to screen', 'under 500 ms', 'Realtime latency test and the load test'],
            ['API p95', 'under 200 ms', 'The load test (Scalability tab)'],
          ],
        },
        { kind: 'heading', text: 'Measured on the chart, on a phone' },
        {
          kind: 'table',
          caption:
            'chartTradingPerf.spec.ts, 390 × 844 phone, focused instrument ticking 4 times a second',
          head: ['Metric', 'Target', 'Result'],
          rows: [
            [
              'Frame time while dragging and scrolling',
              'p95 ≤ 16.7 ms',
              'p50 16.7, p95 16.7, p99 16.8 ms; no dropped frame in 488',
            ],
            ['Long animation frames at 4× CPU throttling', 'none over 50 ms', 'none'],
            ['Price text updates', 'every tick', 'about 25 a second'],
          ],
        },
        { kind: 'heading', text: 'Tick to screen, measured' },
        {
          kind: 'table',
          caption:
            'npm run test:latency, 8 symbols for 10 s over a real Redis, plus one 60 Hz frame to paint (3 runs)',
          head: ['Path', 'Target', 'p95'],
          rows: [
            [
              'apps/quotes → Redis Streams → apps/realtime → browser socket',
              'under 500 ms',
              '240 to 260 ms; most of it is the 250 ms batch window',
            ],
            [
              'API tick pump → Redis pub/sub → apps/realtime → browser socket',
              'under 500 ms',
              '86 to 106 ms',
            ],
          ],
        },
        { kind: 'heading', text: 'What keeps it fast' },
        {
          kind: 'list',
          items: [
            'Ticks skip React: price cells subscribe to their own symbol in an external store, and chart handles are moved by the chart’s own repaint.',
            'One commit per animation frame, however many ticks arrived.',
            'Every route is its own lazy chunk; charts and the mock backend load only when needed.',
            'Binary quote frames, conflated to 4 updates a second per symbol, only for subscribed symbols.',
            'Virtualised long lists, self-hosted subset fonts, SVG icons and skeleton loaders against layout shift.',
          ],
        },
        {
          kind: 'links',
          label: 'Read the code',
          items: [
            { label: 'Build budget check', href: repoLink('apps/web/scripts/checkBuild.mjs') },
            {
              label: 'Chart performance E2E',
              href: repoLink('apps/web/e2e/chartTradingPerf.spec.ts'),
            },
            { label: 'Render performance E2E', href: repoLink('apps/web/e2e/renderPerf.spec.ts') },
          ],
        },
      ],
    },
    {
      id: 'scalability',
      label: 'Scalability',
      title: 'Scalability: 1,000 to 10,000 users, measured',
      summary:
        'A real load test on the full stack, what one process of each server holds, and how it scales out.',
      blocks: [
        {
          kind: 'text',
          text: 'On 24 October 2026 we ran 1,000 to 10,000 concurrent virtual users against one apps/api process and one apps/realtime process on PostgreSQL 16 and Redis 7, all on a single 4-core, 16 GB machine that also ran the load generator. Each user was a real account: it logged in with OTP, held a live price WebSocket, and loaded pages, with one call in ten placing a paper order that writes to Postgres.',
        },
        { kind: 'diagram', id: 'loadTest' },
        {
          kind: 'table',
          caption: 'Results (60 s of sessions after every user logged in)',
          head: [
            'Users',
            'Pace per user',
            'API requests/s',
            'API p95',
            'Errors',
            'Sockets open',
            'Tick to client p95',
          ],
          rows: [
            ['1,000', '1 call / 5 s', '179', '5.4 ms', '0', '1,000', '276 ms'],
            ['5,000', '1 call / 5 s', '887', '27 ms', '0', '5,000', '205 ms'],
            ['7,500', '1 call / 5 s', '1,326', '143 ms', '0', '7,500', '306 ms'],
            ['10,000', '1 call / 5 s', '1,427', '3.4 s', '0', '10,000', '405 ms'],
            ['10,000', '1 call / 15 s', '484', '88 ms', '0', '10,000', '436 ms'],
          ],
        },
        { kind: 'heading', text: 'What the numbers say' },
        {
          kind: 'list',
          items: [
            'Logins: 10,000 users logged in within 19 s, about 550 a second, p95 under 0.5 s, no failures.',
            'Live prices: one realtime process held 10,000 sockets and about 10,900 frames a second, every tick under 500 ms, no dropped frames, at 40% of one core and 456 MB.',
            'API: one process serves about 1,300 to 1,400 requests a second here. Up to 7,500 users calling every 5 s, p95 stays inside the 200 ms target.',
            'At 10,000 users calling every 5 s (2,000 requests a second offered), the one process is the limit: market routes stay fast, but database routes queue for seconds. Nothing fails; it slows down.',
            'At a realistic pace, one call every 15 s because live data comes over the socket, one API process serves 10,000 users at an 88 ms p95.',
          ],
        },
        { kind: 'heading', text: 'Tested capacity' },
        {
          kind: 'facts',
          label: 'Tested capacity on one 4-core machine',
          items: [
            { term: 'Concurrent users', value: '10,000, all logged in, zero errors' },
            { term: 'Live sockets', value: '10,000 on one realtime process' },
            { term: 'API inside 200 ms p95', value: '7,500 users at 1 call / 5 s (1,326 req/s)' },
            { term: 'Login burst', value: '~550 logins per second' },
          ],
        },
        { kind: 'heading', text: 'Scaling past one process' },
        {
          kind: 'list',
          items: [
            'The API keeps no state in the process: sessions, OTPs and rate limits are in Redis, data in Postgres. More API tasks behind the load balancer add capacity, about 1,300 requests a second each on this hardware.',
            'One honest caveat: until Phase 4, order matching and the mock tick pump run inside the API process, so only one API process may run them. Phase 4 moves them into their own worker; then API tasks scale freely.',
            'Realtime nodes scale on their own: each takes its share of sockets and reads the same Redis channel. At scale the channel moves from Redis pub/sub to NATS JetStream.',
            'Postgres: PgBouncer in transaction mode (already in Docker Compose), read replicas for portfolio and order history, and day partitions for orders (the tables are already partitioned).',
            'On AWS Mumbai (Phase 6): ECS Fargate tasks with a scheduled pre-scale at 8:45 AM IST, autoscaling through the day and scale-down after 3:45 PM, a CDN for static files and public market snapshots, and a warm standby in Hyderabad.',
          ],
        },
        {
          kind: 'links',
          label: 'Read the code',
          items: [
            {
              label: 'Load test method and full results',
              href: repoLink('docs/runbooks/load-test.md'),
            },
            { label: 'Load test script', href: repoLink('tools/loadTest/loadTest.mjs') },
            { label: 'Raw results (JSON)', href: repoLink('tools/loadTest/results') },
            { label: 'Scalability rules', href: repoLink('docs/architecture.md') },
          ],
        },
      ],
    },
    {
      id: 'security',
      label: 'Security',
      title: 'Security and compliance',
      summary: 'How accounts, data and the public repository are protected.',
      blocks: [
        {
          kind: 'table',
          caption: 'Security baseline (OWASP ASVS L2)',
          head: ['Area', 'What is in place'],
          rows: [
            [
              'Login',
              'Mobile OTP with a 30 s resend throttle, and a 4-digit device PIN hashed with Argon2id on a trusted browser, plus optional two-factor (TOTP) with recovery codes and step-up for sensitive changes',
            ],
            [
              'Sessions',
              '15-minute signed access token and a rotating refresh token in httpOnly, SameSite=Strict cookies, revocable at once through Redis',
            ],
            [
              'Abuse',
              'Per-IP rate limits (600 a minute, tighter on auth routes), CAPTCHA after 3 failed OTP or PIN attempts, PIN lockout after 5',
            ],
            [
              'Browser',
              'Strict Content Security Policy, X-Frame-Options DENY, HSTS, CSRF token on every state-changing request',
            ],
            [
              'Data',
              'Mobile number and personal data encrypted per column, with a blind index for lookups',
            ],
            [
              'Database',
              'The app connects as a DML-only role; migrations run as the owner role; a separate purge role',
            ],
            ['Audit', 'Append-only audit log for logins, orders and fund movements'],
            [
              'Repository',
              'Public, so no secrets ever: CodeQL, gitleaks, npm audit and Dependabot in CI',
            ],
          ],
        },
        { kind: 'heading', text: 'Compliance' },
        {
          kind: 'list',
          items: [
            'DPDP Act 2023: versioned consent recorded at sign-up, and self-service account deletion with a step-up, logout everywhere and a 30-day purge date.',
            'SEBI: real trading needs a registered broker, so v1 is paper trading only.',
            'Exchange data: real-time NSE or BSE prices need a licence, so v1 uses a simulated feed.',
          ],
        },
        {
          kind: 'links',
          label: 'Read the code',
          items: [
            { label: 'Security baseline', href: repoLink('docs/architecture.md') },
            { label: 'Auth module', href: repoLink('apps/api/src/modules/auth') },
            { label: 'Database roles', href: repoLink('infra/postgres/init.sql') },
          ],
        },
      ],
    },
    {
      id: 'folders',
      label: 'Folder structure',
      title: 'Folder structure',
      summary: 'Where everything lives in the monorepo.',
      blocks: [
        {
          kind: 'code',
          label: 'nthstock/',
          text: 'CLAUDE.md               project rules every agent reads first\nWRITEUP.md              design rationale for the assignment\napps/\n  web/                  React SPA\n    e2e/                Playwright specs: journeys, phone, perf, a11y\n    scripts/            build budgets, no raw colours, import rules\n    src/\n      main.tsx          boot: config, mocks, providers, router\n      app/              app-wide wiring: layouts, live quotes, router\n      routes/           file routes; thin, they load a feature page\n      features/<name>/  dashboard, stockDetail, orderTicket, chartTrading,\n                        scalper, orders, positions, holdings, funds,\n                        watchlist, search, guide, …\n      shared/           cross-feature components and hooks\n      mocks/            MSW handlers and the in-browser market\n  api/                  Fastify modular monolith\n    drizzle/            SQL migrations\n    src/\n      app.ts server.ts config.ts deps.ts\n      db/               Postgres client, migrator, column crypto\n      http/             errors, cookies, CSRF, security headers\n      modules/<name>/   auth, users, watchlists, orders, portfolio,\n                        funds, market, audit, health, docs, demo\n      ticks/            tick pump and Redis publisher\n  realtime/             WebSocket server\n    src/connections/    auth, hub, subscription registry\n    src/feeds/          Redis quote, order and revocation feeds\n  quotes/               tick writer, one per shard behind a Redis lease\npackages/\n  ui/                   design system components and Storybook\n  tokens/               design tokens → CSS variables and Tailwind\n  contracts/            Zod schemas for every REST and WS message\n  marketData/           the mock market\n  paperEngine/          orders, fills, ledger, P&L, trailing stops\n  apiClient/            REST and WS clients, quote and trading stores\n  config/               shared ESLint, TypeScript, Vitest presets\n  utils/                INR formatting, market hours, IST dates, shards\ninfra/                  Docker Compose, PgBouncer, k6\ntools/                  issue keys, release checks, load test\ndocs/                   product, architecture, ADRs, specs, runbooks,\n                        api/openapi.json (generated)\n.claude/                agents, rules, skills, hooks\n.github/                workflows, PR template, CODEOWNERS',
        },
        {
          kind: 'list',
          items: [
            'Imports go one way: routes → features → shared → packages. A lint rule fails any other direction.',
            'A feature is imported only through its index.ts; features do not import each other’s internals.',
            'Names: camelCase files and folders, PascalCase components, UPPER_SNAKE_CASE constants, named exports only.',
            'Tests sit beside the code they test.',
          ],
        },
        {
          kind: 'links',
          label: 'Read the code',
          items: [
            {
              label: 'Repository map (docs/architecture.md §5)',
              href: repoLink('docs/architecture.md'),
            },
            {
              label: 'ADR 0008: repository structure',
              href: repoLink('docs/adr/0008-repository-structure-and-claude-setup.md'),
            },
          ],
        },
      ],
    },
    {
      id: 'testing',
      label: 'Testing',
      title: 'Testing and quality',
      summary: 'The test pyramid, the gates every change passes, and how requirements are traced.',
      blocks: [
        {
          kind: 'table',
          caption: 'Test layers',
          head: ['Layer', 'Tool', 'Size and scope'],
          rows: [
            [
              'Unit and component',
              'Vitest, Testing Library',
              'Over 1,600 cases in 274 files beside the code',
            ],
            [
              'Integration',
              'Vitest with real Postgres and Redis',
              'Repositories, migrations, pub/sub feeds, session revocation',
            ],
            [
              'Contract',
              'Shared Zod schemas and adapter suites',
              'Every market adapter must pass the shared contract suite; mocks are typed from the same schemas',
            ],
            [
              'End to end',
              'Playwright',
              '33 specs: desktop Chrome, Chromium phone and WebKit iPhone',
            ],
            [
              'User journeys',
              'Playwright with real touch events',
              'US-01 to US-05 of the assignment, on a phone',
            ],
            ['Accessibility', 'axe and keyboard-only E2E', 'WCAG 2.2 AA on every screen'],
            ['Performance', 'Playwright perf jobs', 'Web vitals, render and frame-time budgets'],
            ['Load', 'tools/loadTest', '1,000 to 10,000 users on the full stack'],
          ],
        },
        { kind: 'heading', text: 'The quality gate' },
        {
          kind: 'code',
          label: 'npm run check',
          text: 'format:check → lint → typecheck → test → build\n(every workspace, cached by Turborepo)',
        },
        {
          kind: 'list',
          items: [
            'CI repeats the gate and adds E2E, web vitals, the api-mode golden path, Storybook a11y, npm audit, gitleaks and CodeQL.',
            'UI pull requests get before and after screenshots of every changed screen, at 1440 and 390 px, added to the PR automatically.',
            'Every requirement of the assignment maps to code and a test in the requirements matrix.',
            'No test is skipped or quarantined to make CI green; a flaky test is root-caused and fixed.',
          ],
        },
        {
          kind: 'links',
          label: 'Read the code',
          items: [
            {
              label: 'Requirements matrix',
              href: repoLink('docs/specs/trade-from-charts-traceability.md'),
            },
            { label: 'E2E specs', href: repoLink('apps/web/e2e') },
            { label: 'CI workflow', href: repoLink('.github/workflows/ci.yml') },
          ],
        },
      ],
    },
    {
      id: 'ci-cd',
      label: 'CI/CD',
      title: 'CI/CD and releases',
      summary: 'From a pull request to the live site, and where the agents step in.',
      blocks: [
        { kind: 'diagram', id: 'cicd' },
        { kind: 'heading', text: 'Branches and environments' },
        {
          kind: 'table',
          caption: 'Where each branch deploys',
          head: ['Branch', 'Environment', 'How it moves'],
          rows: [
            ['Pull request', 'A preview channel, smoke-tested', 'Every push'],
            ['develop (default)', 'The development site', 'Squash merge of a green, reviewed PR'],
            ['production', 'The live site', 'Only the Promote to production workflow'],
          ],
        },
        { kind: 'heading', text: 'The CI jobs' },
        {
          kind: 'list',
          items: [
            'Lint, typecheck, test, build (npm run check on every workspace).',
            'Storybook build and a11y.',
            'Playwright smoke in Chrome, plus the phone projects.',
            'Web vitals and render budgets in Chrome.',
            'Playwright golden path in api mode, against real apps/api and apps/realtime on Postgres and Redis.',
            'Dependency audit, secret scan (gitleaks) and CodeQL.',
            'PR title check (feat(NSTOCK-0001): …) and automatic PR screenshots.',
          ],
        },
        { kind: 'heading', text: 'A release' },
        {
          kind: 'steps',
          items: [
            'The owner asks for a release.',
            'An agent runs Promote to production. It refuses unless develop’s head commit has green CI and passed the development smoke test.',
            'It moves the production branch to that commit. CI runs on production.',
            'Green CI deploys the live site, which is smoke-tested as a reviewer would use it: login, a buy, the documentation and an accessibility check.',
            'If the smoke test fails, the agent rolls back by redeploying the previous production commit.',
          ],
        },
        {
          kind: 'links',
          label: 'Read the code',
          items: [
            { label: 'Web hosting workflow', href: repoLink('.github/workflows/web-hosting.yml') },
            {
              label: 'Promote to production',
              href: repoLink('.github/workflows/promote-to-production.yml'),
            },
            { label: 'Release runbook', href: repoLink('docs/runbooks/release.md') },
            {
              label: 'ADR 0011: agent-promoted releases',
              href: repoLink('docs/adr/0011-agent-promoted-releases.md'),
            },
          ],
        },
      ],
    },
    {
      id: 'agents',
      label: 'AI agent team',
      title: 'The AI agent team',
      summary: 'Which agents exist, what each one does, and the guardrails around them.',
      blocks: [
        {
          kind: 'text',
          text: 'nthstock is built with Claude Code, Anthropic’s AI coding agent. Interactive Claude Code sessions wrote the specifications, plans and most of the code, directed by the owner. A team of Claude Code agents also runs on GitHub Actions (anthropics/claude-code-action): they plan, build, review and fix, and the owner approves specs and decides what ships.',
        },
        { kind: 'diagram', id: 'agents' },
        {
          kind: 'table',
          caption: 'The agents',
          head: ['Agent', 'When it runs', 'What it does'],
          rows: [
            ['Planner', 'An issue labelled plan:approved', 'Writes a spec PR and the story issues'],
            [
              'Developer',
              'A story labelled agent:ready',
              'Builds the story end to end and opens a PR with “Closes #N”',
            ],
            [
              'Reviewer',
              'Every PR opened or updated',
              'Reviews against CLAUDE.md; labels ready-to-merge or agent:fix-needed',
            ],
            [
              'Frontend reviewer',
              'Called by the Reviewer',
              'React hooks, render and state bugs, accessibility, render performance',
            ],
            [
              'Security reviewer',
              'PRs touching auth, orders, funds or routes',
              'Checks against OWASP ASVS L2, DPDP and the public-repo rules',
            ],
            [
              'Database reviewer',
              'PRs touching schema or SQL',
              'Indexes, locking, constraints, transactions, roles',
            ],
            [
              'Silent-failure hunter',
              'Every code PR',
              'Swallowed errors and fallbacks that hide failures',
            ],
            [
              'Test-gap analyzer',
              'Every code PR',
              'Whether the tests would fail without the change',
            ],
            [
              'Fixer',
              'Blocking findings, red CI, conflicts, red develop',
              'Root-causes and pushes a fix; opens a fix PR when develop is red',
            ],
            [
              'E2E author',
              'On request',
              'Writes and repairs Playwright specs, root-causes flaky ones',
            ],
          ],
        },
        { kind: 'heading', text: 'Automation around them' },
        {
          kind: 'list',
          items: [
            'Auto-merge squash-merges a PR once the Reviewer labels it ready-to-merge and every check is green. Spec PRs and changes to CI or agent config wait for the owner.',
            'Issue closer: a merged PR closes its stories with “Done in #PR”, and an epic closes when all its stories are done.',
            'Scheduled health runs of the full suite (09:20 and 12:30 IST on weekdays, 20:00 IST daily); a red run sends the Fixer.',
            'Conflict resolver: when develop moves, it merges develop into open PR branches.',
            'Issue keys: every issue is titled NSTOCK-0001 : title, and stories are filed under their epic.',
          ],
        },
        { kind: 'heading', text: 'Guardrails' },
        {
          kind: 'list',
          items: [
            'Agents never push to develop or production; a pre-push hook and branch rules block it.',
            'Only the owner or the agent app can start an agent, so strangers on the public repo cannot spend usage or inject prompts.',
            'No attempt or round limits: the Fixer fixes and the Reviewer re-reviews every push until the PR is green; only a no-progress check (the same failure on 5 commits in a row) hands a PR to the owner.',
            'Claude Code hooks in .claude/hooks run format, lint and typecheck on every edit, and block edits to secrets and generated files.',
            'Rules in .claude/rules and skills in .claude/skills give every session the same standards and procedures.',
          ],
        },
        {
          kind: 'links',
          label: 'Read the code',
          items: [
            { label: 'Agent workflow', href: repoLink('docs/agent-workflow.md') },
            { label: 'Agent roles (.claude/agents)', href: repoLink('.claude/agents') },
            { label: 'Claude Code hooks', href: repoLink('.claude/hooks') },
            {
              label: 'ADR 0003: agent team',
              href: repoLink('docs/adr/0003-agent-team-on-github-actions.md'),
            },
            { label: 'AI usage, directed and decided (WRITEUP §7)', href: repoLink('WRITEUP.md') },
          ],
        },
      ],
    },
    {
      id: 'roadmap',
      label: 'Roadmap',
      title: 'Roadmap',
      summary: 'What is done, what is next, and what would come with more time.',
      blocks: [
        {
          kind: 'table',
          caption: 'Phases (each ends with a demo and owner sign-off)',
          head: ['Phase', 'Scope', 'Status'],
          rows: [
            [
              '1',
              'The web app on a mock backend: market pages, accounts, watchlists, portfolio, paper trading',
              'Done',
            ],
            [
              'Assignment',
              'Trade from Charts, trailing stop-loss and Scalper, phone first',
              'Done, live',
            ],
            [
              '2',
              'Backend core on PostgreSQL: persistence, audit, sessions, TOTP, jobs, account deletion',
              'In progress',
            ],
            [
              '3 to 5',
              'Order matching worker, TimescaleDB candles, notifications, hardening',
              'Planned',
            ],
            [
              'Beyond the brief',
              'Chart bar sizes (1, 5, 15, 30 and 60 minutes), price alerts with a notification centre, two-factor authentication with step-up, the active sessions screen, DPDP consent records and self-service account deletion',
              'Done, live',
            ],
            ['6', 'AWS Mumbai, multi-AZ, warm standby in Hyderabad, Terraform', 'Planned'],
          ],
        },
        { kind: 'heading', text: 'Next, with more time' },
        {
          kind: 'list',
          items: [
            'Trailing stops in the matcher worker: they already run on the server in apps/api on Postgres; next they move into the sharded matcher. In India a trailing stop is not an exchange order type, so a broker must run it.',
            'Real-device testing in CI, with two-finger iPhone gestures on a device farm.',
            'Several stops per position, plus SL, SL-M and OCO orders on the same chart lines.',
            'A licensed market data feed behind the same adapter.',
            'The React Native app, reusing the contracts, API client and trading store.',
          ],
        },
        {
          kind: 'links',
          label: 'Read the code',
          items: [
            { label: 'Phased plan (docs/product.md §7)', href: repoLink('docs/product.md') },
            { label: 'Backend core spec', href: repoLink('docs/specs/backend-core.md') },
          ],
        },
      ],
    },
  ]),

  diagrams: {
    system: {
      title: 'System architecture',
      description:
        'The browser app talks to apps/api over REST and receives live data from apps/realtime over a WebSocket. apps/api stores data in PostgreSQL and publishes ticks and order events to Redis, which apps/realtime fans out. In the hosted demo, Mock Service Worker answers the same contracts inside the browser.',
      groups: { browser: 'Your browser', servers: 'Full stack (npm run dev:api)' },
      nodes: {
        spa: ['React SPA', 'routes · features · ui'],
        stores: ['Quote and trading stores', 'one commit per frame'],
        msw: ['Hosted demo', 'Mock Service Worker,', 'market and engine in browser'],
        realtime: ['apps/realtime', 'WebSocket fan-out'],
        api: ['apps/api', 'Fastify modular monolith'],
        engine: ['Mock market + paper engine', 'marketData + paperEngine'],
        redis: ['Redis 7', 'pub/sub, OTPs, limits'],
        postgres: ['PostgreSQL 16', 'system of record'],
      },
      edges: {
        rest: 'REST /v1',
        ws: 'WSS live',
        stores: 'updates',
        demo: 'same contracts',
        pubsub: 'pub/sub',
        publish: 'ticks, orders',
        sql: 'SQL',
        engine: 'ticks, fills',
      },
      inWords: [
        'The React app in your browser calls apps/api over HTTPS REST under /v1.',
        'Live quotes and order updates arrive from apps/realtime over a secure WebSocket and land in the quote and trading stores.',
        'apps/api runs the mock market and the paper engine, stores data in PostgreSQL, and publishes ticks and order events to Redis.',
        'apps/realtime subscribes to Redis and sends each socket only what it subscribed to.',
        'In the hosted demo, Mock Service Worker answers the same REST and WebSocket contracts inside the browser, with the same market and engine packages.',
      ],
    },
    ticks: {
      title: 'Tick pipeline',
      description:
        'A seeded symbol master feeds a GBM price step per instrument inside the mock market adapter. In the hosted demo the in-browser paper engine turns ticks into accountDelta frames for the trading store. On the full stack the API tick pump publishes to Redis and apps/realtime sends conflated binary frames to the quote store.',
      groups: { demo: 'Hosted demo, in the browser', stack: 'Full stack' },
      nodes: {
        master: ['Symbol master', '5,000 equities, seeded'],
        gbm: ['GBM step per instrument', 'focus 250 ms, others 1 s'],
        adapter: ['Mock market adapter', 'candles, depth, replay'],
        engine: ['Paper engine', 'match orders, step stops'],
        delta: ['accountDelta frame', 'every 250 ms, with seq'],
        store: ['Trading store', 'chart, ticket, pad, orders'],
        pump: ['apps/api tick pump', 'Redis TICKS_CHANNEL'],
        hub: ['apps/realtime hub', '4 updates/s, binary frames'],
        quotes: ['Quote store', 'per-symbol cells, one paint'],
      },
      edges: {},
      inWords: [
        'The symbol master creates 5,000 equities and the indices from a fixed seed.',
        'Each instrument steps its price with geometric Brownian motion: the one on screen every 250 ms, the rest every second.',
        'The mock market adapter turns the steps into quotes, 1-minute bars, candles and depth, and can replay missed ticks after a pause.',
        'In the hosted demo, the paper engine matches orders and steps trailing stops on each tick, and sends one accountDelta frame every 250 ms to the trading store.',
        'On the full stack, the apps/api tick pump publishes each batch to Redis, and apps/realtime sends each socket its subscribed symbols, at most 4 updates a second, as binary frames to the quote store.',
      ],
    },
    tslo: {
      title: 'Trailing stop lifecycle',
      description:
        'A trailing stop waits for its entry, is armed until the activation price, then trails, ratcheting with the high. When the price reaches the stop it triggers one exit, which fills or fails. It can be cancelled from any state before it triggers.',
      groups: {},
      nodes: {
        pending: ['Waiting for entry', 'PENDING_ENTRY'],
        armed: ['Armed', 'ARMED'],
        trailing: ['Trailing', 'TRAILING'],
        triggered: ['Triggered', 'TRIGGERED'],
        cancelled: ['Cancelled', 'by user, position closed, day end'],
        rejected: ['Exit failed', 'REJECTED, alert'],
        executed: ['Filled', 'EXECUTED'],
      },
      edges: {
        entry: 'entry fills',
        activate: 'at activation',
        ratchet: 'stop = max(stop, high − trail)',
        trigger: 'LTP ≤ stop',
        fill: 'exit fills',
        fail: 'exit refused',
      },
      inWords: [
        'Waiting for entry: the stop is attached to an order that has not filled yet.',
        'Armed: the entry filled; the stop waits for the price to reach the activation price, or starts trailing at once if there is none.',
        'Trailing: on every tick the high-water mark rises with the price and the stop follows it, never moving back.',
        'Triggered: the price reached or gapped through the stop; one reduce-only exit is placed.',
        'Filled when the exit fills; Exit failed, announced as an alert, if it cannot be placed.',
        'Cancelled from any state before the trigger: by the user, when the position closes or flips another way, or at the end of the day.',
      ],
    },
    cicd: {
      title: 'CI/CD pipeline',
      description:
        'A pull request runs CI and the agent Reviewer. A green, approved PR is squash-merged into develop, which runs CI again and deploys the development site with a smoke test. When the owner asks, Promote to production moves the production branch, and green CI deploys and smoke-tests the live site.',
      groups: {},
      nodes: {
        pr: ['Pull request', 'into develop'],
        checks: ['CI and CodeQL', 'lint · types · tests · build', 'E2E · perf · audit · secrets'],
        review: ['Agent Reviewer', 'ready-to-merge'],
        merge: ['Auto-merge', 'squash into develop'],
        devci: ['CI on develop'],
        devdeploy: ['Development site', 'deploy + smoke test'],
        promote: ['Promote to production', 'gate: CI + dev smoke'],
        prodci: ['CI on production'],
        live: ['Live site', 'deploy + smoke, rollback'],
      },
      edges: {
        fix: 'red → Fixer',
        release: 'owner asks',
      },
      inWords: [
        'Every change is a pull request into develop.',
        'CI runs lint, typecheck, unit tests, the build, E2E, performance budgets, the dependency audit, the secret scan and CodeQL. The agent Reviewer reviews the change.',
        'If anything is red or the review blocks, the Fixer agent pushes a fix to the same PR.',
        'A green PR labelled ready-to-merge is squash-merged into develop. CI runs on develop, and green CI deploys the development site and smoke-tests it.',
        'When the owner asks for a release, Promote to production checks that develop’s head is green and smoke-tested, then moves the production branch.',
        'CI on production deploys the live site and smoke-tests it; a failure is rolled back by redeploying the previous commit.',
      ],
    },
    agents: {
      title: 'Agent loop',
      description:
        'The owner approves a plan. The Planner writes a spec and stories; merging the spec makes the stories ready. The Developer opens a PR; the Reviewer, with five specialists, approves it or sends it to the Fixer. Approved green PRs are merged and their issues closed automatically.',
      groups: {},
      nodes: {
        owner: ['Owner', 'approves specs,', 'asks for releases'],
        planner: ['Planner', 'spec + stories'],
        developer: ['Developer', 'builds a story'],
        reviewer: ['Reviewer', '+ 5 specialists'],
        fixer: ['Fixer', 'findings, red CI'],
        merge: ['Auto-merge', 'close issues'],
      },
      edges: {
        plan: 'plan:approved',
        ready: 'agent:ready',
        pr: 'PR',
        fixNeeded: 'fix-needed',
        pushFix: 'fix pushed',
        approved: 'ready-to-merge',
      },
      inWords: [
        'The owner labels an issue plan:approved.',
        'The Planner writes a spec PR and story issues. When the owner merges the spec, the stories become agent:ready.',
        'The Developer builds a story and opens a PR.',
        'The Reviewer, helped by the frontend, security, database, silent-failure and test-gap specialists, labels the PR ready-to-merge or agent:fix-needed.',
        'The Fixer pushes fixes for blocking findings and red CI to the same PR, and the Reviewer looks again.',
        'Auto-merge squash-merges green, approved PRs and closes their issues.',
      ],
    },
    loadTest: {
      title: 'API p95 latency by concurrent users',
      description:
        'Bar chart of the API p95 latency, on a logarithmic scale, for each load test run, with the 200 ms target marked.',
      target: '200 ms target',
      targetMs: 200,
      overTarget: 'over target',
      axis: 'API p95, log scale',
      range: { min: 1, max: 10_000 },
      ticks: [
        { label: '1 ms', value: 1 },
        { label: '10 ms', value: 10 },
        { label: '100 ms', value: 100 },
        { label: '1 s', value: 1000 },
        { label: '10 s', value: 10_000 },
      ],
      bars: [
        { label: '1,000 users · 1 call / 5 s', value: 5.4, shown: '5.4 ms' },
        { label: '5,000 users · 1 call / 5 s', value: 27.2, shown: '27 ms' },
        { label: '7,500 users · 1 call / 5 s', value: 143, shown: '143 ms' },
        { label: '10,000 users · 1 call / 5 s', value: 3395.2, shown: '3.4 s' },
        { label: '10,000 users · 1 call / 15 s', value: 88.1, shown: '88 ms' },
      ],
      inWords: [
        '1,000 users calling every 5 seconds: 5.4 ms.',
        '5,000 users calling every 5 seconds: 27 ms.',
        '7,500 users calling every 5 seconds: 143 ms, inside the 200 ms target.',
        '10,000 users calling every 5 seconds: 3.4 s; one API process is saturated.',
        '10,000 users calling every 15 seconds: 88 ms.',
      ],
    },
  },
};
