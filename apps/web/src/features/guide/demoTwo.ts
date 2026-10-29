import { repoLink, type GuideImage, type GuideTab } from './model/guideContent';

/** A frame of the before or after set (docs/design), copied to apps/web/public/round2. */
const frame = (
  name: string,
  set: 'before' | 'after',
  width: number,
  height: number,
  alt: string,
): GuideImage => ({ file: `${name}-${set}`, alt, width, height });

/**
 * The Demo 2 tab (NSTOCK-0448): Paytm Money's second round, the craft round of 28 to 30 Oct
 * 2026, for the reviewer who saw the round 1 demo. It is the one link they open, so it carries
 * the brief line by line, before and after frames, what went past the brief, the numbers and the
 * AI note. It is part of the guide's copy (`strings.ts` includes it as a tab), kept in its own file
 * for length; copy belongs here or in `strings.ts`, nowhere else. Keep it in step with DESIGN.md and docs/specs/craft-round.md. Documentation may name
 * the AI tools used (owner decision, 2026-10-24).
 */
export const demoTwoTab: GuideTab = {
  id: 'demo-two',
  label: 'Demo 2',
  title: 'Demo 2: the craft round',
  summary:
    'What Paytm Money asked for in round 2, how each ask was met, and what changed since the round 1 demo, with before and after frames.',
  blocks: [
    {
      kind: 'text',
      text: 'Round 1 asked for features: Trade from Charts, a trailing stop-loss and a scalper. Round 2 asked for craft only: take the mobile flow from the instrument page to the order ticket to the lines on the chart, and make it distinctive and production-grade, with no new trading functionality. This tab is everything that changed between the two demos.',
    },
    {
      kind: 'facts',
      label: 'Demo 2 at a glance',
      items: [
        { term: 'Live site', value: 'nthstock-a13a5.web.app (open it on a phone)' },
        { term: 'Reviewer link', value: 'nthstock-a13a5.web.app/login?try=1' },
        { term: 'Demo login', value: 'Tap Try demo, or 9000000001 with OTP 123456' },
        { term: 'Round 1 demo', value: 'The production build of 25 Oct 2026' },
        { term: 'Round 2 built', value: '28 to 30 Oct 2026, about 40 pull requests' },
        { term: 'Visual direction', value: 'Instrument: a precision tool held in the hand' },
        { term: 'Trading behaviour', value: 'Unchanged: same engine, contracts and orders' },
      ],
    },
    { kind: 'heading', text: 'See it in two minutes, on a phone' },
    {
      kind: 'steps',
      items: [
        'Open nthstock-a13a5.web.app/login?try=1 on your phone from a cold load. It signs you in to a ready-made demo account and opens RELIANCE with a live 10-share position and a 1% trailing stop already on the chart. Tapping Try demo on the login page does the same.',
        'Look at the page before touching it: the price, the whole chart and Sell and Buy are on screen without scrolling, and NIFTY 50 and SENSEX both fit in the header.',
        'Tap Buy. The short sheet shows side, quantity, price type and value, with Buy pinned at its foot. Drag the grabber down to dismiss it, or flick it.',
        'Tap the strip beside the price axis to place a limit order there. Its line slides in from the rail.',
        'Press and drag the order line anywhere along its row: the line follows your thumb, the loupe above it shows price, distance from the last price and order value, and the chart’s crosshair stays asleep. On Android you feel a tick on each price step.',
        'Tap the position chip to add a trailing stop, then open Demo controls and use Rally +1%: the marigold stop glides up and leaves a short trace of where it was.',
        'In Demo controls, under States, tap Loading, Empty, Error and Offline to see every state without breaking anything.',
        'Open the chart type menu and switch between Line, Area, Candles, OHLC and Heikin-Ashi.',
      ],
    },
    { kind: 'loginCta', label: 'Open the demo', href: '/login?try=1' },
    { kind: 'heading', text: 'What the brief asked, and how each ask was met' },
    {
      kind: 'table',
      caption: 'The round 2 brief, line by line',
      head: ['The ask', 'What we did', 'Where to see it'],
      rows: [
        [
          'A visual point of view: a type scale, colour and spacing system, and a signature element or two',
          'A direction called Instrument, chosen from three mock-ups. IBM Plex Sans for words and IBM Plex Mono with tabular figures for every number. Darker ink, finer hairlines and a cooler canvas. Brand blue means action, green and red mean price direction only. Two signature elements: the price rail and the drag loupe.',
          'Any stock page',
        ],
        [
          'Order and trailing-stop drags that feel great: grab affordance, smooth tracking, a clear settle, live labels',
          'Each line has a notched tab on the price rail with a three-bar grip. On grab the tab lifts and the other lines dim; the line follows the thumb with transforms only, at 60 fps; on release it settles on the tick with a spring that never overshoots. The loupe updates price, distance and value live.',
          'Drag an order line',
        ],
        [
          'The drag owns the gesture: the crosshair woke mid-drag',
          'A 44 px grab band runs across the whole plot for each line. Pressing in it captures the pointer and turns off the chart’s crosshair, scroll and scale until release. A press a finger-width away is the chart’s again. A touch test on Chromium and WebKit covers it.',
          'Drag a line, then press beside it',
        ],
        [
          'Sheet open and close motion',
          'The order sheet follows the finger on its grabber and dismisses past 30% of its height or on a flick. One ease-out, one ease-in, three durations (120, 180, 280 ms) and one damped spring are used for every movement.',
          'Open and dismiss the order sheet',
        ],
        [
          'Value-change and price-tick transitions that aid rather than distract',
          'Prices and the order value roll only the digits that changed. On Confirm the sheet folds away and the new line slides in from the rail at its price. A ratcheting trailing stop glides 240 ms with a fading trace. No green or red flash on ticks.',
          'Watch the price; place an order',
        ],
        [
          'Haptic hooks where the device supports them',
          'A light tick on grab, a selection tick on each price step (at most one per 40 ms), a firmer one on crossing the last price, and a success pattern on save. Android uses the Vibration API; iPhone Safari uses a hidden native switch behind a flag. Haptics never carry meaning alone, a setting turns them off, and each step is also announced to screen readers.',
          'Drag a line on Android',
        ],
        [
          'A one-thumb reachability pass',
          'Sell and Buy sit in a dock at the bottom, the sheet’s primary button is pinned above the safe area and the on-screen keyboard, and every control in the flow is at least 44 px.',
          'Any stock page, then Buy',
        ],
        [
          'Price, chart and action above the fold',
          'A 110 px price block with no card, a full-bleed chart at about 40% of the screen height, and chart type and bar size in one row above it. At 360 × 740 the price, the whole plot and Buy and Sell are on screen together.',
          'Any stock page on a phone',
        ],
        [
          'A shorter order sheet with progressive disclosure, so the primary button does not wander',
          'The compact sheet shows only side, quantity, price type and order value. Product, validity, trailing stop and depth are behind More options. The primary button stays in one place.',
          'Tap Buy',
        ],
        [
          'Fix the market-index ticker clipping on narrow screens',
          'NIFTY 50 and SENSEX both fit as name, level and percent from 360 px; market status became a dot. Below 360 px they sit in a compact strip with edge fades, never a marquee.',
          'The header on any phone',
        ],
        [
          'Complete the state set: loading, empty, error, offline',
          'Skeletons in the page’s final shape fade in over 160 ms with no layout shift. Empty and error states for the chart, orders and ticket. Offline, the price says Stale with its time, the chart says Paused, lines show a lock and Buy says why it is off. The States row in Demo controls forces each one.',
          'Demo controls, States',
        ],
        [
          'Respect prefers-reduced-motion',
          'Springs and slides become instant or a 120 ms fade, digit rolls become swaps, the first-run hint does not nudge, and the ratchet jumps without a trace. An end-to-end test fails if any animation runs longer than a frame.',
          'Turn on Reduce motion and repeat',
        ],
        [
          'Keep the accessibility bar: skip link, ARIA, keyboard and the trailing-stop announcer',
          'All kept. Axe runs with no serious or critical issue at 390 × 844, 820 × 1180 and 844 × 390, on the page and the ticket. Reflow at 200% zoom is tested, and drag steps are now announced too.',
          'A screen reader or the keyboard',
        ],
        [
          'Ground rule: no new trading features',
          'The paper engine, contracts, endpoints and realtime are unchanged. The additions in “Beyond the brief” below are display only or reuse the existing order ticket.',
          'n/a',
        ],
      ],
    },
    {
      kind: 'table',
      caption: 'The four deliverables',
      head: ['Deliverable', 'Where it is'],
      rows: [
        [
          'Live on a phone, from a cold load',
          'The live site, promoted to production on 29 Oct. Initial JavaScript is 189 KB gzipped and the login page’s LCP is 1.81 s on 4G with a 4× slower CPU.',
        ],
        [
          'A design rationale with before and after',
          'DESIGN.md at the root of the repository, and this tab. Every screen size has its own before and after set.',
        ],
        [
          'A phone recording of 2 minutes or less',
          'Recorded on a real iPhone from the shot list in docs/design/recordingScript.md and sent with the submission.',
        ],
        ['A one-line AI note', 'The last section of this tab, and section 7 of DESIGN.md.'],
      ],
    },
    { kind: 'heading', text: 'Before and after' },
    {
      kind: 'text',
      text: 'Each pair was captured by the same script at the same screen size: before from the code of the round 1 demo, after from the end of round 2. Tap a frame to open it full size. All 16 screen sizes, with three frames each, are in docs/design.',
    },
    {
      kind: 'compare',
      label: 'Before and after frames',
      items: [
        {
          title: 'Instrument page, 390 × 844 (iPhone 12 to 16)',
          body: 'Before, the chart started at the fold behind a card header and three rows of controls, and Buy was green. After, the chart sits under a compact price block, the controls are one row, Sell is outlined and Buy is blue.',
          before: frame(
            'phone-390x844-instrument',
            'before',
            390,
            844,
            'Round 1 instrument page on a 390 px phone: price card, three control rows, chart starting at the fold',
          ),
          after: frame(
            'phone-390x844-instrument',
            'after',
            390,
            844,
            'Demo 2 instrument page on a 390 px phone: compact price, full-bleed chart, outlined Sell and blue Buy in the dock',
          ),
        },
        {
          title: 'Order ticket, 390 × 844',
          body: 'Before, the primary button sat below the fold behind product, depth and a trailing-stop card. After, the compact sheet shows the essentials and pins Buy INFY at its foot.',
          before: frame(
            'phone-390x844-ticket',
            'before',
            390,
            844,
            'Round 1 order ticket: a long form with the Buy button out of view',
          ),
          after: frame(
            'phone-390x844-ticket',
            'after',
            390,
            844,
            'Demo 2 order ticket: side, quantity, price type and value, with Buy INFY pinned at the bottom',
          ),
        },
        {
          title: 'An order line on the chart, 390 × 844',
          body: 'After, the line’s tab sits on the price rail with a grip, and a first-run hint shows that it can be dragged.',
          before: frame(
            'phone-390x844-orderLine',
            'before',
            390,
            844,
            'Round 1 chart with a buy limit line and a plain label',
          ),
          after: frame(
            'phone-390x844-orderLine',
            'after',
            390,
            844,
            'Demo 2 chart with a buy limit line whose notched tab and grip sit on the price rail',
          ),
        },
        {
          title: 'Order ticket, 360 × 740 (small Android)',
          body: 'The whole compact sheet, with its button, fits a small Android screen.',
          before: frame(
            'phone-360x740-ticket',
            'before',
            360,
            740,
            'Round 1 order ticket on a 360 px phone, cut off below the quantity field',
          ),
          after: frame(
            'phone-360x740-ticket',
            'after',
            360,
            740,
            'Demo 2 order ticket on a 360 px phone, complete with its pinned button',
          ),
        },
        {
          title: 'Instrument page, 320 × 640 (iPhone SE, first generation)',
          body: 'Before, the page scrolled sideways and Buy could not be reached. After, it fits, and the ticker shows both indices in a compact strip.',
          before: frame(
            'phone-320x640-instrument',
            'before',
            320,
            640,
            'Round 1 instrument page at 320 px, wider than the screen',
          ),
          after: frame(
            'phone-320x640-instrument',
            'after',
            320,
            640,
            'Demo 2 instrument page at 320 px, fitting the screen with Sell and Buy in the dock',
          ),
        },
        {
          title: 'Landscape phone, 844 × 390',
          body: 'Before, only the header showed. After, the price is on one line and the chart fills the height, with the dock beside it.',
          before: frame(
            'landscape-844x390-instrument',
            'before',
            844,
            390,
            'Round 1 page on a phone held sideways: only the header is visible',
          ),
          after: frame(
            'landscape-844x390-instrument',
            'after',
            844,
            390,
            'Demo 2 page on a phone held sideways: one-line price and a chart filling the height',
          ),
        },
        {
          title: 'Tablet ticket, 820 × 1180 (iPad Air)',
          body: 'Before, the ticket covered half the chart. After, from 600 to 1023 px the ticket, trailing stop and position editor dock beside the page and the chart narrows.',
          before: frame(
            'tablet-820x1180-ticket',
            'before',
            820,
            1180,
            'Round 1 tablet layout with the ticket covering the chart',
          ),
          after: frame(
            'tablet-820x1180-ticket',
            'after',
            820,
            1180,
            'Demo 2 tablet layout with the ticket docked beside a narrower chart',
          ),
        },
        {
          title: 'Desktop, 1440 × 900',
          body: 'Desktop keeps its layout and picks up the new tokens, type and logo.',
          before: frame(
            'desktop-1440x900-instrument',
            'before',
            1440,
            900,
            'Round 1 desktop instrument page',
          ),
          after: frame(
            'desktop-1440x900-instrument',
            'after',
            1440,
            900,
            'Demo 2 desktop instrument page with the new type, colours and logo',
          ),
        },
      ],
    },
    { kind: 'heading', text: 'After our own client review' },
    {
      kind: 'text',
      text: 'On 29 Oct we reviewed the build the way a Paytm Money reviewer would, on phones from 320 px up, and rated it 7 out of 10. These are the fixes that review led to. Each pair shows the same screen before and after.',
    },
    {
      kind: 'compare',
      label: 'Client review fixes, before and after',
      captions: { before: 'Before: at the review, 29 Oct', after: 'After: the fixes' },
      items: [
        {
          title: 'The order confirmation, 390 × 844',
          body: 'Before, “Order executed” covered Sell, Buy and the new position strip at the moment the order landed. After, on phones confirmations drop in from the top, and the position strip under the chart shows the new position.',
          before: {
            file: 'review-toast-before',
            alt: 'An Order executed toast at the bottom of a phone screen covering the Sell and Buy buttons',
            width: 390,
            height: 844,
          },
          after: {
            file: 'review-toast-after',
            alt: 'An Order executed toast at the top of a phone screen, with Sell, Buy and the position strip visible below the chart',
            width: 390,
            height: 844,
          },
        },
        {
          title: 'Index pages, 390 × 844',
          body: 'Before, an index page still used the round 1 card layout. After, it uses the same phone layout as a stock: a full-bleed chart above the fold, one control row, no NSE/BSE switch for an index, and Sell ETF and Buy ETF in the dock.',
          before: {
            file: 'review-indexPage-before',
            alt: 'The NIFTY 50 page in the old card layout',
            width: 390,
            height: 844,
          },
          after: {
            file: 'review-indexPage-after',
            alt: 'The NIFTY 50 page in the phone instrument layout with Sell ETF and Buy ETF at the foot',
            width: 390,
            height: 844,
          },
        },
        {
          title: 'Funds, 320 × 568',
          body: 'Before, the figures overlapped at 320 px. After, they stack.',
          before: {
            file: 'review-funds-before',
            alt: 'Funds at 320 px with figures overlapping',
            width: 320,
            height: 568,
          },
          after: {
            file: 'review-funds-after',
            alt: 'Funds at 320 px with each figure on its own line',
            width: 320,
            height: 568,
          },
        },
        {
          title: 'Positions, 320 × 568',
          body: 'Before, the table’s columns were cut off. After, Positions and Portfolio are three-line lists on phones, as Orders already was.',
          before: {
            file: 'review-positions-before',
            alt: 'Positions at 320 px with table columns cut off at the right',
            width: 320,
            height: 568,
          },
          after: {
            file: 'review-positions-after',
            alt: 'Positions at 320 px as a list, each row with quantity, average, last price, P&L, Edit and Exit',
            width: 320,
            height: 568,
          },
        },
        {
          title: 'One direction rule, 1440 × 900',
          body: 'Before, a green up arrow from the last tick sat next to a red day change, and a mid-tick frame could catch a rolling digit. After, the price arrow and the 1D line colour both follow the day’s change, and price-rail tick labels that a tag would half cover are hidden.',
          before: {
            file: 'review-desktop-before',
            alt: 'Desktop stock page with a green up arrow beside a red day-change pill',
            width: 1440,
            height: 900,
          },
          after: {
            file: 'review-desktop-after',
            alt: 'Desktop stock page where the arrow and the day change agree',
            width: 1440,
            height: 900,
          },
        },
      ],
    },
    {
      kind: 'list',
      items: [
        'The 1D chart in the first hour of a session leads with the previous session, so it is full from the opening bell instead of a two-point line.',
        'The reviewer link, /login?try=1, signs in and opens RELIANCE with a live position and a trailing stop already on the chart.',
        'The demo simulator folds into one Demo controls button on phones, so it no longer sits in the middle of the page.',
      ],
    },
    { kind: 'heading', text: 'What is distinctive now' },
    {
      kind: 'list',
      items: [
        'The drag owns the gesture, from the first touch to release.',
        'The price rail: the price axis is a ruler with minor and major ticks, and every line’s handle is a notched tab riding on it. A draggable tab has a grip; the position tab has none, because a position cannot be dragged.',
        'The loupe: a dark card above the thumb with price, distance from the last price and order value (or estimated P&L for a stop). It flips sides at the last price and the screen edges, so the thumb never hides the number it is setting.',
        'A drag you can feel: haptics on grab, on each step, on crossing the last price and on save.',
        'The order arrives where it lives: the sheet folds away and the line slides in from the rail.',
        'A ratchet you can see: the trailing stop glides up and leaves a fading trace.',
        'Every state is designed, and every screen size from 320 px phones to tablets and landscape works.',
      ],
    },
    { kind: 'heading', text: 'Beyond the brief' },
    {
      kind: 'text',
      text: 'The brief asked for craft on one flow. These went further, with the owner’s approval, and none adds an order type or engine rule.',
    },
    {
      kind: 'cards',
      items: [
        {
          name: 'Five chart types',
          body: 'Line, Area, Candles, OHLC bars and Heikin-Ashi, from a menu that shows a drawing and a hint for each. Heikin-Ashi is labelled “smoothed, not traded prices” and its tooltip shows the real ones. The switch cross-fades, the rail and lines stay put, and the choice is remembered.',
        },
        {
          name: 'Live candles on every chart',
          body: 'The last candle moves with live prices on every range and bar size, not only on the 1D line.',
        },
        {
          name: 'Price-axis zoom',
          body: 'Drag the price axis to stretch or squeeze the range; Auto fits it again. A tap there still starts an order. Rising candles fill solid green, like falling ones fill red.',
        },
        {
          name: 'Indices you can open and trade',
          body: 'Index cards and the header ticker open each index’s own chart page, which pans and zooms. An index cannot be bought, so Buy ETF and Sell ETF open the existing ticket for its tracking ETF.',
        },
        {
          name: 'A new logo',
          body: 'A bold, rounded two-tone “nth” with a lighter “stock” in IBM Plex. The crossbar of the t is a small rising price line. The app icon and favicon use the same letters.',
        },
        {
          name: 'Every page fits a phone',
          body: 'Orders, Portfolio, Funds, login and every documentation tab were fixed for 320 to 768 px, and a CI check now opens every route at those widths and fails on sideways scroll or cut content.',
        },
        {
          name: 'Tablets, foldables and landscape',
          body: 'Added because the reviewer may not use an iPhone: 16 screen sizes are tested on every pull request.',
        },
      ],
    },
    {
      kind: 'figures',
      label: 'Beyond the brief, on a 390 px phone',
      items: [
        {
          image: {
            file: 'extra-chartTypes',
            alt: 'The chart type menu open, listing Line, Area, Candles, OHLC and Heikin-Ashi with a drawing and a hint for each',
            width: 390,
            height: 844,
          },
          caption: 'The chart type menu',
        },
        {
          image: {
            file: 'extra-heikinAshi',
            alt: 'A Heikin-Ashi chart with its tooltip showing the real open, high, low and close',
            width: 390,
            height: 844,
          },
          caption: 'Heikin-Ashi, with real prices in the tooltip',
        },
        {
          image: {
            file: 'extra-indexEtf',
            alt: 'The NIFTY 50 index page with a candle chart and Sell ETF and Buy ETF buttons',
            width: 390,
            height: 844,
          },
          caption: 'An index page, traded through its ETF',
        },
        {
          image: {
            file: 'extra-login',
            alt: 'The login page with the new nthstock wordmark and a Try demo button',
            width: 390,
            height: 844,
          },
          caption: 'The new logo on the login page',
        },
      ],
    },
    { kind: 'heading', text: 'The numbers' },
    {
      kind: 'table',
      caption: 'Measured on the production build',
      head: ['Measure', 'Result', 'Budget'],
      rows: [
        [
          'Frame time while dragging a line, p50 / p95 / p99 (390 × 844, ticking four times a second)',
          '16.7 / 16.7 / 16.8 ms over 607 frames',
          'p95 within one 60 fps frame',
        ],
        ['Longest animation frame at 4× slower CPU', 'Checked on every merge', '50 ms'],
        ['Login page LCP, first visit, 4G and 4× slower CPU', '2.05 s → 1.81 s', '2.0 s'],
        ['Login page LCP, first visit, slow 4G', '5.05 s → 3.19 s', 'n/a'],
        ['Layout shift (CLS) on the stock page', '0.001', '0.05'],
        ['Initial JavaScript, gzipped', '189 KB', '200 KB'],
        ['Fonts', '84 KB', '100 KB'],
      ],
    },
    {
      kind: 'list',
      items: [
        'Every pull request runs the viewport matrix at 16 screen sizes: no sideways scroll, the primary actions visible and no clipped text.',
        'Every other route and documentation tab is checked at 320 to 768 px.',
        'Axe accessibility checks, reduced motion, 200% reflow, and touch drag tests on Chromium and WebKit (iPhone 13) run in CI.',
      ],
    },
    { kind: 'heading', text: 'AI usage in round 2' },
    {
      kind: 'text',
      text: 'One line: built with Claude Code (Anthropic) for analysis, mock-ups, the spec, code, tests, reviews and the before and after captures; Naresh Payani set the direction, chose the design and accepted every change.',
    },
    {
      kind: 'list',
      items: [
        'Claude Code read the brief, audited the existing flow at three phone sizes and found the crosshair’s root cause: only the line’s 44 px label was a hit target, so a press on the line itself reached the chart’s long-press crosshair.',
        'It drew three visual directions as mock-ups. Naresh chose Instrument and approved the spec, the plan and 17 recorded decisions (Q&A round 10) before any code was written.',
        'Naresh added requirements the AI had not proposed: every screen size, not only iPhones; the five chart types; the new logo; and Buy in brand blue everywhere.',
        'The work ran as about 40 small pull requests. The repository’s agent team on GitHub Actions reviewed each one, and CI had to be green before it merged.',
        'What went wrong and was fixed: several merges broke the develop branch (a hook timeout, a benchmark timeout and a chart snapshot), each fixed in its own pull request; container sizes in rem were wrong because the app’s root font is 14 px; and our own review as the client found a near-empty 1D chart in the morning, a demo link that opened signed out, arrows that disagreed and pages cut at 320 px, which were fixed before this demo (see “After our own client review”).',
      ],
    },
    {
      kind: 'links',
      label: 'Read more',
      items: [
        { label: 'DESIGN.md: the design rationale', href: repoLink('DESIGN.md') },
        { label: 'SPEC-CR-1: the craft round spec', href: repoLink('docs/specs/craft-round.md') },
        {
          label: 'PLAN-CR-1: stories and order',
          href: repoLink('docs/specs/craft-round-tasks.md'),
        },
        { label: 'Every before frame', href: repoLink('docs/design/before/README.md') },
        { label: 'Every after frame', href: repoLink('docs/design/after/README.md') },
        { label: 'Cold load measurements', href: repoLink('docs/design/coldLoad.md') },
        { label: 'Recording shot list', href: repoLink('docs/design/recordingScript.md') },
        { label: 'WRITEUP.md: round 1 and AI usage', href: repoLink('WRITEUP.md') },
      ],
    },
  ],
};
