# Trade from Charts (TFC-1): requirements compliance matrix

| | |
|---|---|
| Document | RCM-TFC-1 |
| Version | 1.0 (approved) |
| Date | 2026-10-22 |
| Product owner and approver | Naresh Payani |
| Specification | [SPEC-TFC-1](trade-from-charts.md) |
| Delivery plan | [PLAN-TFC-1](trade-from-charts-tasks.md) |

Every requirement in the Trade from Charts, TSLO and Scalper requirements (Paytm Money, received
2026-10-22) is listed here with the specification section that meets it, the tasks that build it and
the test that proves it. Requirement text is paraphrased. Status is **Planned** until the proving
test passes, then **Met**. Where the specification interprets a requirement, the row says
**Interpretation** and gives the reason; the product owner approved each one with the specification.

## Trailing stop-loss order (TSLO)

| ID | Requirement | Spec | Tasks | Proving test | Status |
|---|---|---|---|---|---|
| REQ-TSLO-01 | Long: stop sits a trail below the highest price since activation, ratchets up, never down, triggers on touch | §6.3 | T02, T06 | `trailingStop.test.ts`: activation, ratchet only, trigger at stop | Planned |
| REQ-TSLO-02 | Short: mirror image | §6.3 | T02, T06 | `trailingStop.test.ts`: short mirror | Planned |
| REQ-TSLO-03 | Trail in rupees and in percent; the user picks one | §6.1, §7, §8.4 | T01, T02, T13, T18 | Unit tests for both units; ticket component test | Planned |
| REQ-TSLO-04 | Optional activation price; without it, trails at once from entry | §6.1, §6.3 | T02, T13 | `trailingStop.test.ts`: activation | Interpretation: an attached stop starts from the entry fill; a stop added later to an open position starts from the LTP at that moment, because the price history before it was placed is not part of the order |
| REQ-TSLO-05 | On trigger, exit the position quantity; market by default; limit with an offset optional | §6.1, §6.4 | T06, T13 | Engine test: market exit; limit exit with offset | Planned |
| REQ-TSLO-06 | Lifecycle: Armed, Trailing, Triggered, Filled or Cancelled | §6.2 | T01, T06 | Engine lifecycle tests: [`trailingStopLifecycle.test.ts`](../../packages/paperEngine/src/trailingStopLifecycle.test.ts) | Met (adds Waiting for entry and Exit failed, §6.2) |
| REQ-TSLO-07 | Live: the stop recomputes on every tick and the chart line moves as it ratchets | §6.3, §10.1 | T06, T19 | US-04 E2E with the Simulator | Planned |
| REQ-TSLO-08 | Price gaps through the stop: the exit fires once | §6.3 | T02, T06, T09 | Unit test; mock test with Simulator gap | Planned |
| REQ-TSLO-09 | Lifecycle visible wherever the TSLO appears | §6.2, §8.1, §11.1 | T11, T13, T18, T19, T21 | Status asserted on chart, ticket, strip, positions and orders in US-04 | In progress: positions and order rows show the status word and the stop (`app/live/tradingSurfaces.test.tsx`, T11); ticket, chart and strip follow in T13, T18, T19, T21 |
| REQ-TSLO-10 | App backgrounded and resumed: watermark and stop recomputed, not reset | §6.7 | T07, T08 | Replay unit test; E2E with a clock jump and `visibilitychange` | In progress: replay and tick-time engine proven (`simulatedMarket.test.ts`, `paperDesk.test.ts` 15:19 replay); flush on hide in T08; E2E with T13 |
| REQ-TSLO-11 | Invalid trail (≥ price, zero, unreasonable) rejected with a clear message | §6.6 | T02, T13, T18, T19 | Unit tests per rule; component and chart-drag tests | Planned |
| REQ-TSLO-12 | Partial fills and quantity changes: the TSLO tracks the open quantity | §6.4, §10.3 | T05, T06 | Engine tests with split fills; US-02 with Split large fills | Planned |
| REQ-TSLO-13 | Position closed by other means: the TSLO auto-cancels, no orphan | §6.4 | T06, T23 | Engine tests: manual exit, opposite order, Flatten, square-off; US-05 | Planned |

## Trade from Charts

| ID | Requirement | Spec | Tasks | Proving test | Status |
|---|---|---|---|---|---|
| REQ-TFC-01 | A working limit order is a line on the price axis; buy and sell visually distinct | §8.1 | T15, T16 | E2E asserts labels and styles | Planned |
| REQ-TFC-02 | Dragging the line modifies the price live; an affordance cancels it | §8.3, §9.3 | T16 | E2E drag and two-tap cancel | Interpretation (TFC-21): the price follows the finger on every surface in real time and the engine receives one modify on release, so the order cannot fill at a price the user only passed through |
| REQ-TFC-03 | Place a buy or sell from the chart with a chosen, justified gesture | §8.2, §9 | T17 | US-01 E2E | Planned |
| REQ-TFC-04 | Executed position shown at the average price with live P&L | §8.1, §8.4 | T18 | E2E asserts P&L follows the price | Planned |
| REQ-TFC-05 | A TSLO can be attached inline when placing from the chart | §8.2 | T14, T17 | US-02 E2E | Planned |
| REQ-TFC-06 | Tapping the position opens TSLO set, modify and cancel | §8.4, §9.1 | T18, T19 | E2E set, update, cancel from the chip | Planned |
| REQ-TFC-07 | Simplified on-chart TSLO: trail and unit with defaults; the line ratchets visibly and can be dragged to change the trail | §6.5, §8.4 | T18, T19 | US-04 E2E | Planned |
| REQ-TFC-08 | Order lines, position line, TSLO line, depth and ticket never disagree | §10.1 | T08, T10, T11 | Consistency E2E sampling every surface per frame | In progress: one `accountDelta` frame carries the tick, depth and fill (`mocks/handlers/trailingStops.test.ts`); the trading store commits a fill to orders, positions, funds and price together with no disagreeing commit (`mocks/handlers/tradingStore.test.ts`); the order book, positions page and market depth show the same frame, partial fill included (`app/live/tradingSurfaces.test.tsx`, T11); the per-frame consistency E2E follows with the chart surfaces |

## Order ticket

| ID | Requirement | Spec | Tasks | Proving test | Status |
|---|---|---|---|---|---|
| REQ-TKT-01 | TSLO is a first-class order type beside Market and Limit | §7 | T01, T13 | Ticket component test | Planned |
| REQ-TKT-02 | Available as an attached exit on an entry and as a standalone exit on a position | §7 | T13, T14 | Component and mock-backed tests | Planned |
| REQ-TKT-03 | Full parameters and a live preview of the initial stop | §6.1, §7 | T13, T14 | Preview tests for each case | Planned |
| REQ-TKT-04 | Rejects invalid trails; shows margin and charges consistent with the ticket; behaviour unmistakable before confirming | §6.6, §7 | T13, T14 | Component tests; review-step wording test | Planned |
| REQ-TKT-05 | Consistent with Delivery and Intraday, quantity and cash-check patterns | §7 | T13, T14 | Component tests | Planned |

## Scalper

| ID | Requirement | Spec | Tasks | Proving test | Status |
|---|---|---|---|---|---|
| REQ-SCP-01 | Lean pad; no depth-of-market ladder | §4.1, §11.1 | T21 | Screenshot review | Planned |
| REQ-SCP-02 | Preset quantity chips and last-used size; one tap to buy at ask and sell at bid | §11.2 | T05, T21 | E2E from the pad | Planned |
| REQ-SCP-03 | One tap to flatten; one tap to reverse | §11.2, §11.3 | T22 | Component tests | Interpretation (TFC-09): Reverse doubles exposure, so it needs a 400 ms hold; every other action is one tap |
| REQ-SCP-04 | Position, average and live P&L always visible; acknowledgements immediate and unambiguous | §11.4 | T21 | E2E asserts strip, chip and announcement | Planned |
| REQ-SCP-05 | A safety model so a mis-tap cannot fire an order | §11.3 | T22 | Fake-clock disarm tests; nothing sends while disarmed | Planned |
| REQ-SCP-06 | Entry pad stays TSLO-free; tapping the scalp position opens the same TSLO flow | §11.2 | T23 | US-05 E2E | Planned |

## Mobile first

| ID | Requirement | Spec | Tasks | Proving test | Status |
|---|---|---|---|---|---|
| REQ-MOB-01 | Gesture conflicts resolved explicitly and explained | §9 | T20 | Touch E2E for every gesture row | Planned |
| REQ-MOB-02 | Tapping a position is reliable and never places an order | §9.1 | T18, T20 | E2E: tap opens the sheet; pan on the chip pans | Planned |
| REQ-MOB-03 | No dropped frames under live ticks; scrolling and dragging stay smooth | §10.5, §12 | T07, T15, T25 | Performance scenario | Planned |
| REQ-MOB-04 | Thumb reach; targets of at least 44 px; ticket, TSLO options and scalper as bottom sheets | §9.4 | T12 | Layout E2E assertions | In progress: at 360, 390 and 414 px every control on the instrument page is at least 44 px, Sell and Buy sit in the lower 40%, and the ticket is a bottom sheet (`e2e/phoneLayout.spec.ts`, T12); the trailing-stop and scalper sheets follow in T18 and T21 |
| REQ-MOB-05 | Works on 360 to 414 px phones; reviewed on a real phone | §4.3, §12 | T04, T26, T29 | WebKit and Chromium mobile E2E; device check | Planned |
| REQ-MOB-06 | A deliberate phone layout, not a shrunk desktop; desktop stays good | §9.4 | T12 | Screenshots at 360, 390, 414 and 1440 px | Met: phone layout (chart, Overview, Depth and Orders tabs, position strip, sticky bar) with no sideways scroll at 360, 390 and 414 px (`e2e/phoneLayout.spec.ts`); desktop layout checks at 1440 and 768 px unchanged (`e2e/stockDetailJourney.spec.ts`); PR screenshots at 390 and 1440 px |
| REQ-MOB-07 | New surfaces keyboard-operable and screen-reader friendly | §13 | T24 | Keyboard-only E2E; axe | Planned |

## Deliverables and ground rules

| ID | Requirement | Spec | Tasks | Proving test | Status |
|---|---|---|---|---|---|
| REQ-DEL-01 | Public repository with incremental commit history, built on nthstock | §5 (TFC-04) | All | Pull requests with focused commits, linked from the design rationale | Planned |
| REQ-DEL-02 | Live URL that works on a phone from a cold load | §16 | T03, T04, T27, T29 | Deployed smoke at 390 px; device check | Planned |
| REQ-DEL-03 | The five demonstrated flows (US-01 to US-05) work end to end | §4.2 | T09, T26 | Journey E2E | Planned |
| REQ-DEL-04 | Phone screen recording of three minutes or less | §16 | T30 | Video linked in `WRITEUP.md` | Planned |
| REQ-WRT-01 to 08 | Design rationale with the eight required sections: gesture model, TSLO engine, state architecture, scalper design, performance, mobile trade-offs, AI usage, next steps | §9, §6, §10, §11, §12, §9.4, §5, §19 | T28 | Product owner review | Planned |
| REQ-GR-01 | Paper trading only | §14 | All | No brokerage integration in the code | Planned |
| REQ-GR-02 | AI usage disclosed | §5 (TFC-05) | T28 | Design rationale section 7 | Planned |
| REQ-GR-03 | A clean checkout builds and runs | §15 | T28 | CI from a clean checkout; run instructions in the design rationale | Planned |
