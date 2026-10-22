# Spec: Trade from Charts, TSLO and Scalper (mobile first)

- Status: draft for owner review, 2026-10-22
- Phase: "Phase 3: Trade from Charts" in the project chat's numbering. Phase 2 (backend core, E15 to
  E21) is paused until this ships; none of it is needed here (everything runs in mock mode).
- Deadline: submission on 2026-10-25.
- Tasks: [`trade-from-charts-tasks.md`](trade-from-charts-tasks.md) (epics TFC-A to TFC-G)
- Inputs: the client brief (a take-home from Paytm Money, kept outside the repo), CLAUDE.md §0 and §6,
  `docs/requirements-qa.md` Round 9 (TFC-01 to TFC-20), ADR 0004 (mock backend and paper engine),
  ADR 0005 (web UI architecture), and the current `packages/paperEngine`, `packages/contracts`,
  `apps/web/src/mocks` and `apps/web/src/features/{charts,orderTicket,stockDetail,positions}`.

## 1. Problem

nthstock lets a user place Market and Limit paper orders from a ticket sheet and watch a live chart,
but the chart is read only (pan and zoom are off), orders always fill in full, and there is no stop
order of any kind. The brief asks for three capabilities on the instrument page, judged mostly on a
real phone (360 to 414 px wide):

1. **TSLO**, a trailing stop-loss exit order, as a first-class order type.
2. **Trade from Charts (TFC)**: orders, the position and the TSLO as lines on the price chart that
   can be placed, dragged, tapped and cancelled there.
3. **Scalper mode**: a lean one-tap pad for fast entry and exit.

All three must never disagree with each other, with the depth ladder or with the order ticket.

## 2. Goals and non-goals

### Goals

- TSLO behaves exactly as §4 says, including every edge case the brief lists, and is covered by
  unit tests in `packages/paperEngine`.
- One source of truth (§5): every surface derives from the same engine state and the same tick.
- The gesture model (§6) makes pan, zoom, drag order line, drag TSLO line, place order and tap
  position unambiguous on touch, and keeps mouse and keyboard working on desktop.
- A deliberate phone layout (§7), bottom sheets, 44 px targets, one-handed reach.
- No dropped frames under live ticks and while dragging (§9).
- Deliverables: deployed URL that works from a cold load on a phone, WRITEUP.md at the repo root,
  a recording shot list for the owner.

### Non-goals

- Real API, Postgres or realtime-server support for TSLO. The engine lives in `packages/paperEngine`,
  so `apps/api` can adopt it later; `apps/api` must keep compiling and its tests stay green.
- Plain stop-loss (SL, SL-M), bracket, cover or OCO orders. More than one TSLO per position.
- Real market data. The hosted demo stays on the mock feed (CLAUDE.md D3; broker data can't be
  redistributed).
- A depth-of-market ladder in the scalper (the brief rules it out).

## 3. Decisions (2026-10-22)

The owner answered Q1 to Q6 and delegated the rest to the recommended defaults; Round 9 of
`docs/requirements-qa.md` records them. The ones that shape the design:

| ID | Decision | Decided by |
|---|---|---|
| TFC-03 | Mock only; the TSLO engine is real code in `packages/paperEngine`, not a UI fake | Owner (delegated), recommended default |
| TFC-04 | Squash merge stays; each PR keeps several focused commits | Owner |
| TFC-05 | WRITEUP.md names the AI tools honestly (an exception to the attribution rule, for that file only) | Owner (delegated) |
| TFC-07 | Place from chart by tapping the price-axis gutter; lines move only by their handle | Recommended default |
| TFC-08 | Scalper is a mode of the instrument page, not a route | Owner |
| TFC-09 | Scalper safety: Arm switch with idle disarm, hold-to-confirm on Reverse | Recommended default |
| TFC-10 | Partial fills against the depth ladder | Recommended default |
| TFC-11 | Focused instrument ticks 4 times a second | Recommended default |
| TFC-15 | The TSLO keeps "running" while the app is backgrounded; resume replays the missed ticks | Recommended default |
| TFC-16 | iPhone Safari and Android Chrome supported for these surfaces (exception to D4) | Recommended default |

## 4. TSLO behaviour

### 4.1 Terms

A TSLO protects one open position (instrument + product). Its parameters:

| Field | Values | Notes |
|---|---|---|
| `trailUnit` | `ABS` (paise) or `PCT` (basis points) | The user picks one |
| `trailValue` | integer paise, or basis points (150 = 1.5%) | Integers only (CLAUDE.md §6: money is paise) |
| `activationPrice` | paise or null | Null: trails from arming |
| `exitType` | `MARKET` (default) or `LIMIT` | `LIMIT` takes `limitOffset` in paise, ticket only |

Derived state, owned by the engine: `status`, `extreme` (the high-water mark for a long, the
low-water mark for a short), `stop`, `qty` (the protected open quantity), `exitOrderId`,
`statusReason`, timestamps.

### 4.2 Lifecycle

`ARMED` (set, waiting for the activation price) → `TRAILING` (stop ratchets) → `TRIGGERED` (exit
order sent) → `FILLED` (exit fully filled). `CANCELLED` is reachable from `ARMED`, `TRAILING` and
`TRIGGERED` (the user cancels the working limit exit). Every surface that shows a TSLO shows its
status word and, when trailing, the stop.

### 4.3 The step function

`stepTrailingStop(state, ltp) → { state, trigger }` is pure and runs on every tick of the
instrument, in tick order. For a **long** position (a short mirrors every comparison):

1. `ARMED`: if `activationPrice` is null or `ltp ≥ activationPrice`, become `TRAILING` with
   `extreme = ltp`. Otherwise stay.
2. `TRAILING`: `extreme = max(extreme, ltp)`; `trail = ABS ? trailValue : extreme × trailValue / 10,000`;
   `stop = floorToTick(extreme − trail)` (a short uses `ceilToTick(extreme + trail)`). The stop
   never moves down: `stop = max(previousStop, stop)`.
3. Trigger when `ltp ≤ stop`. The comparison is "at or through", so a gap that jumps well past the
   stop still triggers. Triggering sets `TRIGGERED` and returns one exit intent; a `TRIGGERED`,
   `FILLED` or `CANCELLED` TSLO ignores every later tick, so the exit fires exactly once.

A TSLO attached to an entry starts `ARMED` once the first fill lands, with the fill price as its
first tick. A standalone TSLO starts from the LTP when it is placed.

### 4.4 Quantity and auto-cancel

- `qty` always equals the position's current open quantity in the protected direction, recomputed
  after every fill (entry partial fills grow it; a manual partial exit shrinks it).
- When the position goes flat or flips direction by any other means (manual exit, opposite order,
  scalper flatten or reverse, intraday square-off), the TSLO becomes `CANCELLED` with reason
  "Position closed" in the same engine step. No orphan stop survives a step.
- On trigger the exit order is for `qty` at that moment. Its own partial fills keep the TSLO
  `TRIGGERED` until the position is flat, then `FILLED`.
- One TSLO per position: placing a new one replaces (modifies) the existing one.

### 4.5 Validation

Rejected with a plain-language message, in the engine (authoritative) and in the ticket and chart
(as you type or drag):

- trail of zero, negative, or below one tick (₹0.05) in effect;
- `ABS` trail ≥ the current price, or above 20% of it ("unreasonable");
- `PCT` trail below 0.1% or above 20%;
- activation price on the wrong side of the market is allowed (it activates at once) but the
  preview says so;
- no open position (standalone) or a position in the other direction;
- limit offset negative or ≥ the stop.

### 4.6 Backgrounded app

Mobile browsers freeze timers in a background tab, and in mock mode the "exchange" is in the page.
Resume therefore works like a server that never stopped:

- The mock market notices the gap (timer drift above 2 tick intervals) and emits the missed ticks
  as one catch-up batch before the next live tick, capped at 30 minutes of session time. The
  engine steps every TSLO through them in order, so the extreme, the stop and any trigger are
  exactly what continuous running would have produced.
- Engine state, including each TSLO's `extreme` and `stop`, is in the existing localStorage
  snapshot (`apps/web/src/mocks/handlers/orders.ts`), so a reload restores it too.
- The client never computes a stop itself; on `visibilitychange` it reconnects and re-reads state.

## 5. State architecture

```
mock market (ticks, depth)          ← demo Simulator pushes scripted moves here
        │ every tick, in order
        ▼
paperEngine (per account)           ← the only authority: orders, fills, positions, TSLOs
        │ one WS frame per flush: quotes + orderUpdate + positionUpdate + tslUpdate
        ▼
tradingStore (zustand, per account) ← normalised by id, versioned by engine sequence number
        │ selectors
        ▼
chart overlay · depth · ticket · positions strip · scalper pad · orders page
```

- **One authority.** Orders, positions and TSLOs change only inside the engine. The client sends
  intents (place, modify, cancel) over the existing REST routes plus new TSLO routes.
- **One frame.** The mock's 250 ms flush already batches quotes. Order, position and TSLO updates
  caused by those ticks go out in the same frame, and the client applies the frame in one store
  transaction, so the chart line, the depth and the P&L never show a mixed state.
- **Sequence numbers.** Every engine change carries a monotonically increasing `seq`; the store
  drops stale updates, and a gap triggers a re-read.
- **Pending intents.** A drag or a placement in flight lives in a separate `pending` slice keyed
  by order id, drawn as a dashed line, and cleared on the engine's acknowledgement or rejection
  (rejection snaps the line back and shows the reason).
- **Rendering.** Surfaces that move every tick (lines, P&L) subscribe to the store outside React
  and paint in `requestAnimationFrame`. React re-renders only when the set of objects changes.

## 6. Gesture model

The chart has two zones: the **plot** and the **price-axis gutter** on the right (64 px on touch,
the library's axis on desktop). Each gesture belongs to one zone or one handle, so nothing has to
be guessed from intent.

| Gesture | Where | Does |
|---|---|---|
| One-finger drag | Plot | Pan time (library) |
| Pinch | Plot | Zoom time (library) |
| Long-press | Plot | Crosshair (library); never trades |
| Tap | Plot | Nothing trading-related |
| Tap | Gutter, on empty space | Drops a ghost line at that price with Buy and Sell chips |
| Drag | A line's handle (pill on the gutter, 44 × 44 px hit area) | Moves that order or TSLO line; the chart's own scroll is off for the drag |
| Tap | Position chip (left of the plot, on the average-price line) | Opens the TSLO sheet for that position |
| Tap | × on an order handle | First tap turns it into "Cancel?", second tap within 3 s cancels |

Rules that make it safe:

- A handle drag starts only after 6 px of vertical movement; less is a tap. Prices snap to ₹0.05;
  a label beside the finger shows the price (and, for TSLO, the new trail) while dragging.
- Order lines commit on release (one modify per drag, with the live label as the "live" feel);
  a release outside the gutter or a second finger cancels the drag.
- The ghost line opens a compact bottom sheet: side, quantity, price, product, and an inline
  "Add trailing stop" row (unit + value). Nothing is sent before the sheet's Place button.
- Tap on the position chip is accepted only for a pointer that moved under 10 px and lasted under
  400 ms, so a pan that starts on the chip pans.
- Desktop: the same handles take mouse drag; click on the gutter places; keyboard below.

Rejected alternatives (for WRITEUP §1): long-press to place (collides with the crosshair and is
slow), dragging lines by their body (a 1 px line competes with pan), a separate "edit mode" toggle
(one more tap on every action), and double-tap to place (accidental orders while zooming).

## 7. Surfaces

### 7.1 Instrument page, phone

Header (symbol, LTP, change) → chart at about 55% of the viewport with range control → tabs
(Overview, Depth, Orders) → a sticky bottom bar with Sell, Buy and a Scalp switch. When a position
exists, a position strip sits above the bar: `+10 @ ₹1,234.50 · +₹120.00 · TSLO Trailing ₹1,228.40`.
The chart enables pan and zoom on this page only and opens on 1D with the last 60 minutes in view.

### 7.2 Instrument page, desktop

The current two-column layout stays; the chart gains the overlay, and the ticket keeps its side
sheet. The same gutter and handles work with a mouse.

### 7.3 Chart overlay

- Lines are drawn in the chart's canvas by a series primitive (one render pass with the candles).
- Handles and chips are absolutely positioned buttons, moved with `transform` in one rAF per frame
  from `series.priceToCoordinate`; off-screen prices pin to the top or bottom edge with an arrow.
- Buy lines use the brand blue, sell lines the down colour, the TSLO line a dashed amber with its
  status; every line also carries a text label, so colour is never the only signal.
- The position line shows quantity, average and live P&L; the TSLO line shows `TSLO ₹1,228.40 ·
  1.5%` and moves as it ratchets. Dragging it changes the trail distance (`|extreme − new stop|`,
  in the TSLO's unit).

### 7.4 Order ticket

- Order type: Market, Limit, TSLO. TSLO appears only when the user has an open position in the
  instrument; it is then an exit for that position.
- Market and Limit entries get an "Add trailing stop" section (attached TSLO).
- Full parameters: unit (₹ / %), value, optional activation price, exit type (Market, or Limit
  with an offset).
- A live preview sentence: "Initial stop ₹1,480.00, trails 1.5% below the high (activates at
  ₹1,520.00)". Validation messages under the field; the review step restates the behaviour.
- Delivery/Intraday, quantity, cash check and charges keep today's patterns.

### 7.5 TSLO sheet (from the chart or a scalp position)

Lightweight: status, current stop, unit (₹ / %) and value with sensible defaults (1% or ₹ equal
to 1% of price), Set / Update / Cancel. A "More options" link opens the full ticket.

### 7.6 Scalper mode

- The Scalp switch replaces the bottom bar with a pad: quantity chips (1, 5, 10, 25, and the last
  custom size, remembered), **Sell at bid** and **Buy at ask** (marketable limit orders at the
  depth's best price, so the price is exactly what the button says), **Flatten** and **Reverse**.
- Product is Intraday so a scalper can go short.
- Safety: an **Arm** switch must be on for any pad button to send. It disarms after 2 minutes
  without a trade, when the page is hidden, and when the user leaves the instrument. Reverse
  (which doubles exposure) also needs a 400 ms hold, with a fill ring.
- Feedback: the position strip (qty, average, live P&L) is always visible above the pad; each tap
  shows an acknowledgement chip ("Bought 10 @ ₹1,234.55") and a fill toast, and announces it to
  screen readers.
- Flatten closes the position and cancels the instrument's working entry orders. The TSLO
  auto-cancels by §4.4.
- No TSLO on the pad. Tapping the position strip or the chart's position chip opens §7.5.

### 7.7 Positions and orders pages

Rows show TSLO status and stop; partially filled orders show `3 / 10 filled`.

## 8. Contracts

In `packages/contracts`:

- `TrailUnit = 'ABS' | 'PCT'`, `TslStatus`, `TslParams`, `Tsl` (§4.1), `PlaceTslRequest`,
  `ModifyTslRequest`.
- `PlaceOrderRequest.attachedTsl?: TslParams` for an entry.
- `OrderHistoryEvent` gains `PARTIALLY_EXECUTED`.
- WS server messages gain `positionUpdate` and `tslUpdate`; every update carries `seq`. The
  `quotes` frame may be followed by these in one batch message (`batch`), applied atomically.
- REST (mock only for now): `GET /v1/tsl`, `POST /v1/tsl`, `PATCH /v1/tsl/:id`, `DELETE /v1/tsl/:id`.
  `apps/api` returns 501 for these routes until a later phase.

## 9. Performance

- No React render per tick on the chart: the overlay paints from the store in rAF.
- The library updates only the last candle per tick (already the case, T-108).
- Drag handlers do no allocation-heavy work; modifies are sent once on release.
- Measured in a Playwright perf test at 390 × 844 with 4× CPU throttling: 4 ticks a second plus a
  scripted drag for 10 s, no long task over 50 ms and a p95 frame under 20 ms, read from a
  `PerformanceObserver`. The numbers go in WRITEUP §5.

## 10. Accessibility

- Every handle and chip is a `button` with a label such as "Buy limit 10 at ₹1,234.50. Arrow keys
  move, Enter saves, Delete cancels". Arrow keys move one tick, Shift + arrow ten ticks, Escape
  reverts.
- A visually hidden "Chart orders" list mirrors the lines for screen readers and keyboard users.
- Fills, TSLO triggers and cancellations are announced in a polite live region.
- Bottom sheets trap focus and restore it; the scalper's hold-to-confirm also accepts a keyboard
  press held for 400 ms.

## 11. Demo and delivery

- **Try demo**: a button on the login page that seeds the demo account and signs in, so a cold load
  on a phone needs no OTP typing.
- **Simulator** (demo mode only, labelled as such): Rally +1%, Pull back −1%, Gap −3%, and a
  "Large fills split" switch. It feeds scripted ticks through the same path as live ticks, so the
  recording can show a ratchet and a trigger inside three minutes. WRITEUP mentions it.
- WRITEUP.md at the repo root with the brief's eight sections; §7 (AI usage) lists what the owner
  directed, what the AI proposed or decided, and what was corrected, drawn from §3 and the PR
  history.
- A recording shot list (`docs/runbooks/tfc-recording.md`) for the five flows the brief names.
- Deployed by the Promote to production workflow once develop is green.

## 12. Acceptance criteria

1. Every edge case in §4 has a passing unit test: ratchet up only, short mirror, activation, gap
   through (one exit), auto-cancel on flat and on flip, resume catch-up, invalid trails, partial
   entry fills growing `qty`, partial exits shrinking it.
2. Placing a limit by tapping the gutter, dragging its handle to a new price, and cancelling it
   all work at 390 px with touch emulation and on desktop with a mouse (E2E).
3. Attaching a TSLO while placing from the chart, letting the entry fill, and seeing the TSLO line
   ratchet then trigger, with the position line, depth, ticket and positions page agreeing at every
   step (E2E, with the Simulator).
4. A scalp round trip (arm, buy, flatten) works one-handed at 390 px; nothing sends while disarmed.
5. The perf budget in §9 holds.
6. axe finds no serious violations on the instrument page in both modes; the chart orders are
   operable by keyboard alone.
7. `npm run check` is green and the production URL works from a cold load on an iPhone (Safari) and
   an Android phone (Chrome).

## 13. Risks

| Risk | Mitigation |
|---|---|
| Three days is tight | Tasks are tagged Must or Should; Should tasks are cut first |
| `lightweight-charts` gestures fight our handles on iOS | Handles sit on the gutter, outside the library's pan area; scroll is turned off for the drag |
| A random walk won't trigger a TSLO on camera | The Simulator (§11) |
| WebKit not in CI | Owner tests on a real iPhone at each phone gate |
