# Trade from Charts: task list (TFC-A to TFC-G)

> Status: draft for owner review, 2026-10-22. Spec: [`trade-from-charts.md`](trade-from-charts.md).
> Phase: "Phase 3: Trade from Charts" in the project chat's numbering. Deadline 2026-10-25.

## How to use this list

Each epic becomes a GitHub epic and each task a story (sub-issue) with its own `NSTOCK-` key, created
after the owner merges the spec. One story per PR, several focused commits per PR, squash merge.
Work top to bottom; a task starts when everything in `Depends:` is merged. `npm run check` is green
on every PR.

`Must` tasks are the brief's requirements; `Should` tasks are cut first if time runs out.

**Format:** `- [ ] TFC-TNN [TRACK] [Must|Should] Title. Depends: …. Done when: ….`
Tracks: `[ENG]` packages (contracts, paperEngine, marketData), `[MOCK]` apps/web/src/mocks,
`[FE]` apps/web, `[QA]` tests and tooling, `[DOC]` docs.

**Schedule**

| Day | Date | Epics |
|---|---|---|
| 1 | 2026-10-22 to 23 | A (engine), B (store) |
| 2 | 2026-10-24 | C (ticket), D (chart), E (phone layout and gestures) |
| 3 | 2026-10-25 | F (scalper), G (delivery) |

## TFC-A: TSLO engine, partial fills and mock market

- [ ] TFC-T01 [ENG] [Must] TSLO contracts: `TrailUnit`, `TslStatus`, `TslParams`, `Tsl`, place and modify requests, `attachedTsl` on `PlaceOrderRequest`, `PARTIALLY_EXECUTED` history event, WS `positionUpdate`, `tslUpdate`, `batch`, `seq`. Depends: none. Done when: schemas and fixtures exist with tests; `apps/api` compiles and its tests pass.
- [ ] TFC-T02 [ENG] [Must] Pure trailing-stop step function and validation (`packages/paperEngine/src/trailingStop.ts`). Depends: TFC-T01. Done when: unit and property tests cover ratchet-only, short mirror, ABS and PCT, activation, gap-through firing once, tick rounding, and every §4.5 rule, plus `previewTrailingStop` matching the first engine step.
- [ ] TFC-T03 [ENG] [Must] Partial fills: the matcher fills up to the depth quantity at the price per tick; history records `PARTIALLY_EXECUTED`. Depends: TFC-T01. Done when: a large limit fills over several ticks in tests; existing engine and API tests stay green.
- [ ] TFC-T04 [ENG] [Must] TSLO lifecycle in the engine: standalone and attached TSLOs, `qty` tracks the open position, auto-cancel on flat or flip, exit order on trigger (market or limit with offset), one TSLO per position, `seq` on every change, snapshot and restore. Depends: TFC-T02, TFC-T03. Done when: engine tests cover every §4.4 rule, including partial entry and exit fills.
- [ ] TFC-T05 [MOCK] [Must] Mock routes and socket: `/v1/tsl` routes, `attachedTsl` on place, `positionUpdate` and `tslUpdate` in one `batch` frame with the quotes they came from, persistence in the orders snapshot. Depends: TFC-T04. Done when: handler tests cover place, modify, cancel, trigger and reload.
- [ ] TFC-T06 [ENG] [Must] Mock market: 250 ms ticks for subscribed instruments on screen, catch-up ticks after a frozen timer (capped at 30 minutes). Depends: none. Done when: an adapter test with a fake clock that jumps 5 minutes gets the missed ticks in order, once, and the WS frame carries only the coalesced quote.
- [ ] TFC-T07 [MOCK] [Must] Demo Simulator: Rally, Pull back, Gap, "Large fills split", in demo mode only, through the live tick path. Depends: TFC-T05, TFC-T06. Done when: a scripted gap triggers a TSLO in a mock test; the Simulator is absent from non-demo builds.

## TFC-B: One source of truth

- [ ] TFC-T08 [FE] [Must] `tradingStore` (zustand): orders, positions and TSLOs by id from REST bootstrap and WS frames, `seq` checks and re-read on a gap, atomic batch apply, `pending` slice for in-flight intents, selectors, re-read on `visibilitychange`. Depends: TFC-T05. Done when: store tests cover stale updates, gaps, pending then ack, pending then reject.
- [ ] TFC-T09 [FE] [Must] Move positions, orders and the depth card onto the store's selectors where they need lockstep updates; partially filled orders show `3 / 10 filled`; rows show TSLO status and stop. Depends: TFC-T08. Done when: existing E2E passes unchanged and a new test shows a fill updating positions and orders in the same frame.

## TFC-C: Order ticket TSLO

- [ ] TFC-T10 [FE] [Must] TSLO order type in the ticket as an exit for an open position: unit, value, activation price, exit type and limit offset, validation messages. Depends: TFC-T08. Done when: component tests cover each §4.5 message and a placed TSLO appears in the store.
- [ ] TFC-T11 [FE] [Must] "Add trailing stop" on Market and Limit entries (attached TSLO), included in review, charges and cash check. Depends: TFC-T10. Done when: an entry with an attached TSLO fills and the TSLO arms in a mock-backed test.
- [ ] TFC-T12 [FE] [Must] Live preview sentence and review-step wording, updating with inputs and price. Depends: TFC-T10. Done when: tests cover ABS, PCT, activation and short wording.

## TFC-D: Trade from Charts

- [ ] TFC-T13 [FE] [Must] Chart overlay foundation: series primitive for lines, DOM handle layer positioned in rAF from the store, edge pinning, pan and zoom on for the instrument page, price-axis gutter. Depends: TFC-T08. Done when: lines follow the price scale while panning and zooming with no React render per tick (render-count test).
- [ ] TFC-T14 [FE] [Must] Working order lines: buy and sell styles with labels, drag the handle to modify (commit on release, snap, live label, pending line, rollback on reject), two-tap cancel. Depends: TFC-T13. Done when: E2E drags and cancels a limit with mouse and with touch emulation.
- [ ] TFC-T15 [FE] [Must] Place from chart: tap the gutter for a ghost line with Buy and Sell chips, compact sheet with inline TSLO, nothing sent before Place. Depends: TFC-T14, TFC-T11. Done when: E2E places a limit with an attached TSLO from the chart at 390 px.
- [ ] TFC-T16 [FE] [Must] Position line with live P&L and the position chip; tap opens the TSLO sheet (set, update, cancel, "More options" to the ticket). Depends: TFC-T13, TFC-T10. Done when: E2E sets a TSLO from the chip; a pan starting on the chip pans.
- [ ] TFC-T17 [FE] [Must] TSLO line: dashed, labelled with status and trail, ratchets with ticks, drag changes the trail distance. Depends: TFC-T16. Done when: E2E with the Simulator shows the line moving up on a rally, not on a pullback, and the drag updating the trail.
- [ ] TFC-T18 [FE] [Should] Keyboard and screen reader: handles operable with arrows, Enter, Escape and Delete; hidden "Chart orders" list; live-region announcements. Depends: TFC-T14, TFC-T17. Done when: a keyboard-only E2E modifies and cancels an order; axe is clean.

## TFC-E: Phone layout and gestures

- [ ] TFC-T19 [FE] [Must] Phone layout of the instrument page (§7.1): chart at about 55% height, tabs, sticky bottom bar, position strip; desktop layout unchanged. Depends: TFC-T09. Done when: screenshots at 360, 390 and 414 px show no horizontal scroll and every target is at least 44 px.
- [ ] TFC-T20 [FE] [Must] Gesture model hardening on touch (§6): drag threshold, second finger cancels, tap-versus-pan on the chip, scroll lock during handle drags, iOS Safari specifics (`touch-action`, no rubber band). Depends: TFC-T14, TFC-T16, TFC-T17. Done when: touch E2E covers each row of the §6 table; the owner checks it on a phone.
- [ ] TFC-T21 [FE] [Must] Bottom sheets for the ticket, chart placement and TSLO: safe-area insets, keyboard avoidance, one-handed reach, focus handling. Depends: TFC-T15, TFC-T16. Done when: the owner places an order one-handed on a phone.

## TFC-F: Scalper mode

- [ ] TFC-T22 [FE] [Must] Scalp switch and pad: quantity chips with remembered custom size, Buy at ask and Sell at bid as marketable limits, position strip, acknowledgement chips. Depends: TFC-T19. Done when: E2E buys and sells from the pad at 390 px.
- [ ] TFC-T23 [FE] [Must] Flatten and Reverse, Arm switch with idle, hidden and leave disarm, hold-to-confirm Reverse. Depends: TFC-T22. Done when: tests show nothing sends while disarmed and Reverse needs the hold.
- [ ] TFC-T24 [FE] [Must] Scalp position to TSLO: the position strip and chart chip open the TSLO sheet; flatten auto-cancels the TSLO. Depends: TFC-T23, TFC-T16. Done when: E2E scalps, sets a TSLO, flattens, and the TSLO shows Cancelled.

## TFC-G: Quality and delivery

- [ ] TFC-T25 [QA] [Must] Perf test (§9) under ticks and drag at 390 px with CPU throttling; fixes for anything over budget. Depends: TFC-T20, TFC-T22. Done when: the test passes in CI and its numbers are recorded.
- [ ] TFC-T26 [QA] [Must] E2E for the five recording flows at 390 px, plus routes in `e2e/screens/screens.ts`. Depends: TFC-T24. Done when: the suite is green in CI.
- [ ] TFC-T27 [FE] [Must] "Try demo" on the login page: seed and sign in with one tap. Depends: none. Done when: a cold load of the production URL reaches the instrument page in two taps.
- [ ] TFC-T28 [DOC] [Must] WRITEUP.md (eight sections) and the recording shot list. Depends: TFC-T26. Done when: the owner has read it and every claim matches the code.
- [ ] TFC-T29 [QA] [Must] Production deploy and phone smoke test on iPhone Safari and Android Chrome. Depends: TFC-T26, TFC-T27, TFC-T28. Done when: the owner signs off on a phone.
