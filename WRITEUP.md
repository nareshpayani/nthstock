# Trade from Charts, Trailing Stop-Loss and Scalper: design rationale

Naresh Payani · TFC-1 · October 2026

**Try it on a phone:** <https://nthstock-a13a5.web.app/login>, then tap **Try demo**. It is paper
trading on a simulated NSE market that is always open in the demo. A labelled "Demo simulator" on
the instrument page moves the price, so a trailing stop can be shown ratcheting and triggering in
seconds. **Walkthrough video:** linked here at release (T30). **Script:**
[docs/runbooks/demo-walkthrough.md](docs/runbooks/demo-walkthrough.md).

The full specification is [SPEC-TFC-1](docs/specs/trade-from-charts.md), the architecture decision
is [ADR 0012](docs/adr/0012-trading-state-and-chart-gestures.md), and every requirement in the
brief is mapped to code and tests in the
[compliance matrix](docs/specs/trade-from-charts-traceability.md).

## 1. Gesture model

**Rule: zones decide, not timing.** On a phone, one finger has to pan the chart, place an order,
drag an order line, drag a stop line and open a position. So each gesture belongs to a zone of the
screen, and no gesture depends on how long or how quickly a finger is held.

| Gesture                           | Zone                     | Result                                                                    |
| --------------------------------- | ------------------------ | ------------------------------------------------------------------------- |
| One-finger horizontal drag, pinch | Plot                     | Pan and zoom time. A vertical drag scrolls the page                       |
| Long-press                        | Plot                     | Crosshair. It never trades                                                |
| Tap                               | Empty price-axis gutter  | A ghost line at that price, with Buy and Sell chips. Nothing is sent yet  |
| Drag                              | A line's 44 px handle    | Moves that order, ghost or stop line; the chart does not pan              |
| Tap                               | Position chip            | Opens the trailing-stop sheet. A drag that starts on the chip still pans  |
| Two taps within 3 s               | × on an order handle     | Cancel                                                                    |

How it is built:

- **Handles live in the gutter.** They are DOM buttons with `touch-action: none` and pointer
  capture, so a drag that starts on a handle can never reach the chart's pan. A handle becomes a
  drag after 6 px of movement ([handleGesture.ts](apps/web/src/features/chartTrading/model/handleGesture.ts)).
- **Escape hatches.** A second finger, Escape, or a release within 6 px of the start cancels the
  drag and restores the line.
- **The chip tap comes from the chart's own click event.** The chart fires that event only for a
  real tap, so a tap on a position can't turn into a pan or an order.
- **"Live" drag.** The price follows the finger on every surface (chart, ticket, depth, orders list)
  in real time. The engine gets one modify, on release. A modify per frame would let the order fill
  at a price the user only passed through (TFC-21).

Rejected alternatives:

- **Long-press to place:** it collides with the crosshair, and it is slow.
- **Dragging a line by its body:** a 1 px line competes with pan, and it was unreliable on touch.
- **An edit-mode toggle:** it adds a tap to every action.
- **Double-tap to place:** it causes accidental orders while zooming.

Every row of this table is tested by real touch events on Chromium mobile. On WebKit iPhone,
Playwright supports one finger, so that project runs every row that needs only one
([chartGestures.spec.ts](apps/web/e2e/chartGestures.spec.ts)).

## 2. TSLO engine

The trailing logic lives only in the paper engine, as a pure function:
`stepTrailingStop(state, tick)` in
[packages/paperEngine/src/trailingStop.ts](packages/paperEngine/src/trailingStop.ts). It runs for
every active stop on every tick of its instrument, in tick order, in the same engine step as order
matching. For a long position:

- **Activation.** Trailing starts at once, or when the LTP reaches the activation price. The
  watermark starts at that LTP.
- **Ratchet.** `watermark = max(watermark, LTP)`. Then
  `stop = max(stop, floorToTick(watermark − trail))`, so the stop never moves back.
- **Trigger.** At `LTP ≤ stop`, the stop places one reduce-only exit (market by default, or a limit
  with an offset). A short position mirrors every comparison.

**Keeping the chart, ticket and position view in sync.** The client never computes a live stop.
`previewTrailingStop` exports the same arithmetic for the ticket's "Initial stop ₹1,480.00, trails
1.5% below the high" before placement. After that, every surface draws the engine's stop from the
same frame (§3).

Edge cases from the brief, each with its test:

| Case                         | Behaviour                                                                                                                                                                                                                                                                                                                                                            | Proof                                                                                                   |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Gap through the stop         | The trigger compares "at or through", so a gap still triggers, and a `TRIGGERED` stop ignores later ticks. The exit fires once, at the gap price                                                                                                                                                                                                                       | `trailingStop.test.ts` "triggers once on a gap", `trailingStopLifecycle.test.ts` "fires once on a gap"  |
| Position closed another way  | Any fill that makes the position flat or flips it (a manual exit, an opposite order, Flatten, the square-off) cancels the stop and its working exit in the same step, with the reason "Position closed". If a manual exit and a trigger land on the same tick, the position closes once and does not flip                                                              | `trailingStopLifecycle.test.ts` "is cancelled when the position closes or flips", "same tick … no flip" |
| Resumed from the background  | Phones freeze timers. Each instrument has its own random stream, so when the timer fires late, the market replays the missed ticks with their timestamps, up to 30 minutes. The engine steps through them as if it had never paused: the watermark, stop and trigger match a continuous run. Replaying 30 minutes takes under 100 ms                                  | `simulatedMarket.test.ts` "replays the missed ticks…", "…under 100 ms"                                  |
| Invalid trail                | A trail of zero, under ₹0.05, over 20% of the price, or a stop dragged to or through the LTP is refused with a plain message, in the engine and as the user types                                                                                                                                                                                                       | `trailingStop.test.ts` `validateTrailingStop`                                                           |
| Partial fills                | `protectedQty` follows the open quantity after every fill. The exit is capped at the open quantity                                                                                                                                                                                                                                                                    | `trailingStopLifecycle.test.ts` "grows with partial entry fills…", `partialFills.test.ts`               |

The lifecycle the brief asks for (Armed, Trailing, Triggered, Filled or Cancelled) gains two honest
states: "Waiting for entry", for a stop attached to an unfilled order, and "Exit failed", which is
announced as an alert because the position is unprotected.

A page that the browser discarded and reloaded can't replay. It resumes from the last saved
snapshot as one price move, and the exit still fires once if the stop was crossed.

## 3. State architecture

**One authority, one frame, one store** ([ADR 0012](docs/adr/0012-trading-state-and-chart-gestures.md)).

```
simulated market ─ticks─▶ paper engine ─accountDelta (seq)─▶ trading store ─▶ chart · ticket · depth · strip · pad · orders · positions
        ▲                                                                       │
        └──────── Demo simulator               place / modify / cancel ◀────────┘
```

- **The engine** ([packages/paperEngine](packages/paperEngine/src)) is the only code that changes
  orders, fills, positions and stops. Every change carries a rising `seq`.
- **One `accountDelta` frame** every 250 ms carries the quotes, the focused instrument's depth, and
  every order, position and stop change those ticks caused. So the fill, the new position, the
  cancelled stop and the price that caused them arrive together.
- **The trading store**
  ([packages/apiClient/src/tradingStore.ts](packages/apiClient/src/tradingStore.ts)):
  - It applies each frame in one commit, in the same animation frame as the quotes.
  - It drops stale `seq`s and re-reads the account on a gap or a reconnect.
  - It writes through to the TanStack Query caches, so the orders and positions pages agree with
    the chart.
  - It is framework-free, so the future React Native app can reuse it.
- **Pending intents.** Place, modify, cancel and close are tracked until a response or a frame
  covers them. That is how a dragged line shows "Updating…" at its new price without ever
  disagreeing with the order book.

The brief's "live truth" requirement is tested in `tradingStore.test.ts` (stale frames, gaps, no
older copy ever replacing a newer one) and in `tradingSurfaces.test.tsx` ("moves the order book,
positions and depth from one frame with a partial fill").

## 4. Scalper design

**Fast.** The Scalp switch replaces the bottom bar with a pad; the chart stays on screen. The pad
has:

- quantity chips 1, 5, 10 and 25, plus the last custom size, which the device remembers;
- Sell at bid and Buy at ask;
- Flatten and Reverse.

Buy and Sell send an IOC marketable limit at the price shown on the button, taken from the same
frame's depth. The order fills at that price or better, and nothing is left resting by accident.
Market orders were rejected because the user would not know the price they tap.

**Safe.** The safety model is designed to add as little friction as possible:

- **An Arm switch.** Disarmed, the buttons read "Arm to trade" and send nothing (tested by
  counting requests).
- **Automatic disarm** after 2 minutes without a trade, when the page is hidden, or when the
  instrument changes.
- **Only Reverse needs a 400 ms hold, with a progress ring.** Reverse is the one action that
  doubles exposure. Keyboard users hold Enter or Space.
- **No confirmation dialogs.** A dialog on every tap defeats scalping.

The rejected models were a confirmation dialog on every order and a hold on every button.

**Feedback.** The position strip (quantity, average, live P&L) stays above the pad. Every tap gets
an acknowledgement ("Bought 5 @ ₹1,234.55", "Partly filled", "Not filled", the rejection reason)
and a toast.

**TSLO in the scalper.** I followed the brief: the pad has no trailing-stop controls, because entry
must stay one tap. A scalp creates an ordinary position, so tapping the position strip opens the
same trailing-stop sheet as the chart's position chip. Flatten goes through the engine's
`closePosition`, which cancels the stop in the same step. Code:
[features/scalper](apps/web/src/features/scalper); journey:
[journeys.spec.ts](apps/web/e2e/journeys.spec.ts) (US-05).

## 5. Performance

What keeps it smooth:

- **Per-tick painting skips React.** Lines use the chart library's price lines, and handle
  positions are recomputed in a series primitive's view update, which the chart calls on every
  repaint. So handles stay glued to their price during pan, pinch and autoscale, and React renders
  only when a line appears or disappears. A unit test asserts that a tick causes no React render.
- **One commit per frame.** The trading store batches the whole frame, so five surfaces update in
  one render.
- **Only the focused instrument ticks at 250 ms**; the rest tick each second.
- **Replay only where it matters.** After a resume, only instruments with working orders or stops
  are replayed tick by tick.

How it is measured
([chartTradingPerf.spec.ts](apps/web/e2e/chartTradingPerf.spec.ts), run in CI). The scenario is a
390 × 844 phone with the focused instrument ticking 4 times a second. It drags a handle for 3 s,
then scrolls the page for 3 s:

| Metric                                                   | Target          | Result (Chromium, 2026-10-23)                                   |
| -------------------------------------------------------- | --------------- | --------------------------------------------------------------- |
| Frame time (`requestAnimationFrame` deltas)              | p95 ≤ 16.7 ms   | p50 16.7, p95 16.7, p99 16.8 ms; no dropped frame in 488 frames |
| Long animation frames, at 4× CPU throttling              | none over 50 ms | none                                                            |
| Price text updates on screen                             | every tick      | about 25 a second                                               |

To prove the observer works, an injected 80 ms busy frame was caught at 127.8 ms under
throttling. The CI check is "p95 under 1.5 frames", because a perfect frame reads 16.6 to 16.8 ms
with vsync jitter.

## 6. Mobile trade-offs

What changed for the phone:

- **Primary actions sit in the thumb zone.** Sell, Buy and Scalp are in a sticky bottom bar, in the
  lower 40% of the screen.
- **Bottom sheets.** The order ticket, the chart's compact ticket, the trailing-stop sheet and the
  scalper pad are bottom sheets or bottom-anchored, with safe-area insets.
- **44 px targets everywhere.** E2E checks this at 360, 390 and 414 px, along with no sideways
  scroll.
- **The chart is the page.** Depth, Overview and Orders become tabs under it, and a position strip
  stays visible.
- **The chart keeps its gutter.** Price-axis drag scaling and axis double-click reset are turned
  off, because the gutter belongs to trading.

Desktop keeps its two-column layout, and the same gutter and handles work with a mouse. Keyboard
users get full labels on every handle ("arrow keys move one tick, Shift ten, Enter saves, Escape
restores, Delete cancels"). Trailing-stop triggers and cancellations are announced to screen
readers, and a failed exit is announced as an alert
([chartKeyboard.spec.ts](apps/web/e2e/chartKeyboard.spec.ts)).

Deliberately left out on phones:

- the depth card next to the chart (it moved to a tab);
- the key-stats card (moved to Overview);
- hover tooltips (replaced by the long-press crosshair);
- the full trailing-stop parameter set on the chart (trail and unit only; "More options" opens the
  full ticket);
- haptics, which iOS Safari does not expose to web pages.

## 7. AI usage: directed and decided

**Tools.** I used Claude Code (Anthropic) throughout. Interactive sessions wrote the specification,
the plan and most of the code. The repository's agent team on GitHub Actions (Planner, Developer,
Reviewer and Fixer, defined in [.claude/agents](.claude/agents)) reviewed every pull request and
opened fix pull requests when the scheduled test runs failed. Hooks in
[.claude/hooks](.claude/hooks) run the same format, lint and typecheck rules on every edit as CI
does.

**What I directed.** Every decision is logged with its alternatives in
[SPEC-TFC-1 §5](docs/specs/trade-from-charts.md) and
[requirements Q&A Round 9](docs/requirements-qa.md).

- **The schedule.** I set a three-day release (the AI proposed two weeks), and I paused my own
  Phase 2 backend work for it.
- **A real engine.** Simulated data only, but a production-grade trailing-stop engine in the shared
  paper engine. A client-side imitation of a stop was not acceptable.
- **The scalper's place.** It is a mode of the instrument page, not a new route.
- **The working process.** Engineering proposes every decision with alternatives, and I approve or
  overrule. I required squash merges that keep several focused commits per pull request, so the
  history shows how the work was done. Specs and the traceability matrix had to be written to a
  standard I could hand to a director.
- **Paper trading only.** No brokerage, no real money. Production deploys happen only when I ask.

**What the AI proposed and I accepted.**

- The gutter-tap gesture model, and the four rejected alternatives in §1.
- The Arm-and-hold safety model.
- IOC marketable limits for the scalper.
- Replaying missed ticks on resume instead of restarting the trail.
- The labelled demo simulator.
- One modify on release for a "live" drag.
- The single-frame trading store, with its amendment to my earlier ADR 0005.

Each came with its alternatives and a reason, such as one modify on release, so that an order can
never fill at a price the finger only passed through.

**What was corrected or rejected.** These were caught by tests, review or me:

- **A flaky WebKit gesture test.** The first fix (parking the mouse) was wrong. The root cause was
  that the page scrolled between two screenshots of the time axis. It was reproduced on Chromium at
  the iPhone's height and fixed properly (#462).
- **An unmeetable performance check.** The first check was "p95 ≤ 16.7 ms", and it failed at 16.8
  ms because of vsync jitter. The target stayed. The check became "under 1.5 frames", which still
  fails on any dropped frame, and the reason is recorded in the test.
- **Focus not returned.** The trailing-stop sheet did not return focus to the chip that opened it.
  The keyboard-only E2E found this before review did.
- **Two fill toasts.** A scalp fill and the generic order fill could both toast. Now one toast is
  claimed per fill.
- **A duplicate fix pull request.** The Fixer agent opened one for a failure that was already fixed.
  I closed it rather than merge two fixes.
- **Kept out of the code:** "Claude" attribution in commits and pull requests, which I rejected
  (this file is the one disclosure), and a two-hourly watchdog agent, which I rejected as noise.

## 8. Next, with more time

1. **Trailing stops on the server.** Move the engine into `apps/api` on PostgreSQL, with
   `apps/realtime` sending the same `accountDelta`. In a real product a trailing stop must run on
   the broker's side, because it is not an exchange-native order type in India.
2. **Real-device testing in CI**, with two-finger WebKit gestures on a device farm. Today they run on
   Chromium only, and iPhone checks are manual.
3. **Several stops per position** (scale-out), plus SL, SL-M and OCO orders on the same lines.
4. **Depth-driven partial fills by default.** Today the simulator can force split fills.
5. **The React Native app** reusing the trading store and the contracts (CLAUDE.md D10).

## Run it from a clean checkout

Requires Node 22 (`.nvmrc`) and npm.

```bash
git clone https://github.com/nareshpayani/nthstock.git && cd nthstock
npm install
VITE_MOCK_MARKET_OPEN=true npm run dev -w @nthstock/web   # http://localhost:5173/login → Try demo
npm run check                                            # format, lint, typecheck, tests, build
npx playwright install chromium                          # once, for the E2E browsers
npm run e2e                                              # Playwright: desktop Chrome and Chromium mobile
```

No servers or Docker are needed: the market, the paper engine and the API run in the browser behind
Mock Service Worker, which is also how the hosted demo runs. For more, see
[docs/runbooks/local-demo.md](docs/runbooks/local-demo.md).
