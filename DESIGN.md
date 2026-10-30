# nthstock: design notes for the mobile Trade from Charts flow

The craft round (28 to 30 Oct 2026) changed no trading behaviour. It worked on how the mobile
flow looks, moves and feels: the instrument page, the order ticket, and the lines on the chart (the
order lines, the position and the trailing stop). This file covers the decisions, the references,
what is now distinctive, before and after frames at every screen size, the numbers, and the AI note.

- **Live:** https://nthstock-a13a5.web.app/login?try=1 (signs in to the demo and opens RELIANCE with a position and a trailing stop on the chart)
- **Spec and plan:** [SPEC-CR-1](docs/specs/craft-round.md), [PLAN-CR-1](docs/specs/craft-round-tasks.md)
- **Recording (1:38, iPhone 16 Pro Max screen, 1320 × 2868):** https://nthstock-a13a5.web.app/demo/craftRecording.mp4 (also played on the guide's Demo 2 tab), recorded from the shot list in [docs/design/recordingScript.md](docs/design/recordingScript.md)
- **Frames:** [before](docs/design/before/README.md) and [after](docs/design/after/README.md)

## 1. What the brief asked, and what we found

The baseline audit on 28 Oct (captured before any change, [before set](docs/design/before/README.md)):

| Finding                                                                          | Where                                                              |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| A press near an order line woke the chart's crosshair, and the line did not move | Every touch screen; the before recording shows it at 390 × 844     |
| The ticket's primary button sat below the fold                                   | Every phone                                                        |
| The chart started below the fold                                                 | Every phone from 360 × 740 up; in landscape no chart showed at all |
| The index ticker clipped SENSEX                                                  | Every phone                                                        |
| The page scrolled sideways, and Buy could not be reached                         | 320 × 640                                                          |
| Buy was green in the trade bar and blue on the chart                             | Everywhere                                                         |
| Tablets and foldables got the desktop card layout                                | 673 to 1180 px                                                     |

## 2. Direction: "Instrument"

Three directions were mocked up and Direction B, **Instrument**, was chosen
([mock-ups](https://claude.ai/artifact/SwYwm31TapSxKD3TFQpcvZ)). The idea: a trading screen should
feel like a precise tool, not a card feed. Each number has a fixed place, each line has a
handle, and the chart's price axis becomes a ruler you set prices on.

**Decisions**

| Decision                                                                                              | Why                                                                                                                        |
| ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Brand blue (#1463D8) means action: Buy, the primary button, the selected side                         | Green and red mean price direction only. Buy was green in one place and blue in another, so a colour carried two meanings. |
| Sell is outlined in down red; Buy is filled blue                                                      | The two actions can't be confused, even in greyscale, and the primary one is heavier                                       |
| IBM Plex Sans for words, IBM Plex Mono with tabular figures for every number                          | Prices don't jitter sideways as they tick; the mono gives the instrument feel                                              |
| Darker ink (#0B1526), finer hairlines (#E4E8EE), cooler canvas                                        | More contrast and a quieter ground, so the chart and the numbers lead                                                      |
| Marigold for the trailing stop, as fill only, with `marigold-ink` (#A86B00) for its stroke            | The stop is its own kind of thing, neither buy nor sell. Marigold fails contrast as text, so it never is text.             |
| A new wordmark and app icon: a bold two-tone "nth" with a lighter "stock", in brand blue and IBM Plex | The mark matches the type and the blue the screens use, and it reads at favicon size                                       |
| Full-bleed sections divided by hairlines on phones, not cards                                         | Cards cost 32 px of width and a border on a 360 px screen                                                                  |
| Motion tokens: one ease-out, one ease-in, 120 / 180 / 280 ms, one critically damped spring            | Every movement in the flow uses the same few curves, so it feels like one system                                           |
| Haptics follow Apple's three meanings (impact, selection, notification)                               | They feel native on both platforms. They never carry meaning alone, and a setting turns them off.                          |

**References** (for inspiration only; nothing was copied):

- Zerodha Kite: dense, calm number layout and the restraint of its order window.
- Apple Stocks and the iOS Clock picker: the selection tick as a value changes, and tabular figures.
- Robinhood: the order moment, where the order visibly lands where it lives.
- TradingView: price-axis tabs that belong to the lines they label.

## 3. What is distinctive now

1. **The drag owns the gesture.** Each draggable line has a 44 px grab band across the whole plot.
   Pressing in it captures the pointer and switches off the chart's crosshair, scroll and scale
   until release. A press a finger-width off the line is the chart's again (pan, pinch,
   crosshair). This fixes the audit's main defect, and an automated touch test covers it on
   Chromium and WebKit.
2. **The price rail.** The price axis is a ruler with minor and major ticks. Each line's handle is
   a notched tab sitting on it. A draggable tab carries a grip (three short bars); the position tab
   carries none, because you can't drag a position.
3. **The loupe.** While a line is held, a dark card above the thumb shows the price, the distance
   from the last price and the order value (or estimated P&L for a stop). It flips sides at the last
   price and at the screen edges, so the thumb never hides the number it is setting.
4. **A drag you can feel.** Grabbing gives a light tick, each price step a selection tick
   (throttled to one per 40 ms), crossing the last price a firmer one, and saving a success
   pattern. Android uses the Vibration API. iPhone Safari uses a hidden native switch, behind a
   flag. Each step is also announced to screen readers.
5. **The tab lifts and settles.** On grab the tab lifts (scale 1.04 with a raised shadow) and the
   other lines dim. On release it settles with a spring that never overshoots the tick.
6. **The order arrives where it lives.** On Confirm the sheet folds away, and the new order line
   slides in from the rail at its price. The order value and the price roll only the digits that
   changed.
7. **A ratchet you can see.** When a trailing stop moves up, its line glides 240 ms and leaves a
   short fading trace of where it was.
8. **A shorter order sheet.** The compact detent shows only side, quantity, price type and the
   order value. Product, validity, trailing stop and depth are behind "More options". The primary
   button is pinned above the safe area and the on-screen keyboard. The sheet follows the finger on
   its grabber and dismisses past 30% of its height or on a flick.
9. **Every state is designed.** The page's skeletons have the final shape and fade in over 160
   ms with no layout shift. There are empty, error and offline states: offline, the price says
   Stale with its time, the chart says Paused, lines show a lock, and Buy says why it is off. The
   demo's "States" row forces each state, so a reviewer can see them without breaking anything.
10. **Every screen size.** Phones from 320 to 440 px keep the chart and both actions above the
    fold. In landscape the price fits on one line and the chart fills the height. From 600 to
    1023 px (tablets, unfolded foldables) the ticket, the trailing stop and the position editor
    dock beside the page instead of covering it. From 1024 px on a touch screen, the desktop
    layout gets 44 px controls.

11. **A phone app, not a shrunk website.** Below 768 px the shell is a native app's: a bottom tab
    bar in thumb reach (Home, Portfolio, a raised blue Trade button, Orders, Account) replaces the
    menu drawer. The top bar holds the avatar, a switch between sibling pages (Market or
    Watchlist, Holdings or Positions) and the bell, over the index strip. Home leads with the
    portfolio value and the day's P&L, then the chart, Add funds and Place order side by side,
    and Watchlist, Gainers and Losers as rows. Trade, from any tab, is search and then the stock's
    page with the ticket up. A stock's page is pushed over the tabs with a back button, so its
    Sell, Buy and Scalp bar keeps the bottom edge. Tablets keep the drawer. An E2E test
    (`phoneShell.spec.ts`) walks from the tabs to every feature the desktop has.

**Reduced motion.** With `prefers-reduced-motion`, springs and slides become instant or a 120 ms
fade, digit rolls become swaps, the hint does not nudge, and the ratchet jumps without a trace.
Haptics are unaffected; they have their own setting. An E2E test checks that no finite animation
runs longer than a frame under reduced motion.

## 4. Before and after

Each pair was captured with the same script at the same size: before from `develop` at `cd5c1b7`,
after from `develop` at the end of the round. All 16 sizes, three frames each (instrument page,
open ticket, order line on the chart): [before](docs/design/before/README.md) and
[after](docs/design/after/README.md). Highlights:

| Size                                     | Before                                                   | After                                                   |
| ---------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------- |
| 390 × 844 instrument (iPhone 12 to 16)   | ![](docs/design/before/phone-390x844-instrument.jpg)     | ![](docs/design/after/phone-390x844-instrument.jpg)     |
| 390 × 844 ticket                         | ![](docs/design/before/phone-390x844-ticket.jpg)         | ![](docs/design/after/phone-390x844-ticket.jpg)         |
| 390 × 844 order line                     | ![](docs/design/before/phone-390x844-orderLine.jpg)      | ![](docs/design/after/phone-390x844-orderLine.jpg)      |
| 360 × 740 ticket (small Android)         | ![](docs/design/before/phone-360x740-ticket.jpg)         | ![](docs/design/after/phone-360x740-ticket.jpg)         |
| 320 × 640 instrument (iPhone SE 1st gen) | ![](docs/design/before/phone-320x640-instrument.jpg)     | ![](docs/design/after/phone-320x640-instrument.jpg)     |
| 844 × 390 landscape                      | ![](docs/design/before/landscape-844x390-instrument.jpg) | ![](docs/design/after/landscape-844x390-instrument.jpg) |
| 820 × 1180 ticket (iPad Air)             | ![](docs/design/before/tablet-820x1180-ticket.jpg)       | ![](docs/design/after/tablet-820x1180-ticket.jpg)       |

The phone app shell (NSTOCK-0466), before from `develop` at `3bb0572`, after on its branch, both
390 × 844 and signed in as the demo user:

| Screen                       | Before                                              | After                                              |
| ---------------------------- | --------------------------------------------------- | -------------------------------------------------- |
| Home                         | ![](docs/design/before/shell-390x844-home.jpg)      | ![](docs/design/after/shell-390x844-home.jpg)      |
| Portfolio                    | ![](docs/design/before/shell-390x844-portfolio.jpg) | ![](docs/design/after/shell-390x844-portfolio.jpg) |
| Orders                       | ![](docs/design/before/shell-390x844-orders.jpg)    | ![](docs/design/after/shell-390x844-orders.jpg)    |
| Account (new; before, a 404) | ![](docs/design/before/shell-390x844-account.jpg)   | ![](docs/design/after/shell-390x844-account.jpg)   |

What changed in those frames:

- **390 × 844:** before, the chart started at the fold behind a card header and three control
  rows. After, the chart sits right under a 110 px price block, and the controls are one row
  (type and interval menus). Sell is outlined and Buy is blue.
- **Ticket:** before, the button was below the fold behind product, depth and a trailing-stop
  card. After, the compact sheet fits on a 360 × 740 screen with **Buy INFY** pinned at the foot.
- **Order line:** after, the tab has a grip and sits on the rail, with the first-run hint above it.
- **320 × 640:** before, the page scrolled sideways and Buy was out of reach. After, it fits, and
  the ticker shows NIFTY 50 and SENSEX in a compact strip.
- **Landscape:** before, only the header showed. After, the price is on one line, with the chart
  and the dock below it.
- **Tablet:** before, the ticket covered half the chart. After, it docks beside the page and the
  chart narrows.

## 5. Numbers

**Frame time while dragging** (390 × 844, the instrument ticking four times a second, a line
dragged and the page scrolled; `e2e/chartTradingPerf.spec.ts`):

| Measure                                 | Result                                                                            | Budget                      |
| --------------------------------------- | --------------------------------------------------------------------------------- | --------------------------- |
| Frame time p50 / p95 / p99, unthrottled | 16.7 / 16.7 / 16.8 ms (607 frames in 10 s)                                        | p95 within one 60 fps frame |
| Price updates on screen                 | 31 a second                                                                       | n/a                         |
| Longest animation frame at 4× CPU       | Enforced in CI's "Web vitals and render budgets" job, which passed on every merge | 50 ms                       |

The drag moves the line, tab and loupe with transforms only. No React render runs per pointer
move, so the drag itself never makes a long frame.

**Cold load on a phone** (production build, 390 × 844, fresh profile, median of three runs;
detail in [docs/design/coldLoad.md](docs/design/coldLoad.md)):

| Screen                | Profile         | LCP before | LCP after | CLS   |
| --------------------- | --------------- | ---------- | --------- | ----- |
| `/login`, first visit | Slow 4G, 4× CPU | 5.05 s     | 3.19 s    | 0     |
| `/login`, first visit | 4G, 4× CPU      | 2.05 s     | 1.81 s    | 0     |
| `/dashboard?demo=1`   | 4G, 4× CPU      | 2.06 s     | 2.13 s    | 0.001 |
| `/stocks/INFY`        | 4G, 4× CPU      | 2.64 s     | 2.71 s    | 0.001 |

Initial JS is 189 KB gzipped (budget 200 KB) and fonts are 84 KB (budget 100 KB). In the demo,
the data screens wait for the in-browser mock backend (348 KB). With the real API that chunk is
not built. coldLoad.md explains this, and the two experiments that were measured and dropped.

**Quality gates**, all in CI on every PR:

- the viewport matrix at 16 sizes, with no horizontal scroll, the primary actions visible and no
  clipped text;
- every other route (orders, portfolio, funds, login, each documentation tab) at 320 to 768 px,
  with no sideways scroll and nothing past the screen or cut;
- axe with no serious or critical violations, at 390 × 844, 820 × 1180 and 844 × 390, on the page
  and the ticket;
- reduced motion;
- reflow at the 200% zoom equivalent;
- the touch tests on Chromium and WebKit (iPhone 13).

## 6. Scope kept and descoped

The craft round added no trading features. Contracts, the paper engine and realtime are unchanged.
The one addition beyond craft was more chart types: Line, Area, Candles, OHLC bars and
Heikin-Ashi, labelled "smoothed, not traded prices". It was approved during the round so the
reviewer can feel the switch, and it is display only. Nothing on the descoping list
(PLAN-CR-1 §4) had to be cut: the iPhone haptics flag, the order's arrival, the ratchet trace and
the tablet landscape polish all shipped.

## 7. AI note

Built with AI coding agents for planning, code, tests, reviews and captures (the tools are named in
[WRITEUP.md](WRITEUP.md)). Naresh Payani set the direction, chose the design and accepted each change.
