# 0012. One trading state for every surface, and the chart gesture model

- Status: Proposed (accepted when the TFC-1 specification is approved)
- Date: 2026-10-22
- Specification: [SPEC-TFC-1](../specs/trade-from-charts.md) §6, §9 and §10
- Amends: [0005](0005-web-ui-architecture.md) (server state is no longer TanStack Query only)
- Builds on: [0004](0004-mock-backend-and-paper-engine.md) (mock backend and paper engine)

## Context

Trade from Charts, the trailing stop-loss order and the scalper show the same orders, positions and
stops on five surfaces at once: chart lines, depth, order ticket, position strip and scalper pad.
The requirements state that these surfaces must never disagree, that the stop recomputes on every
tick, and that resuming a backgrounded phone must not reset it.

Currently, orders reach the web app as `orderUpdate` socket messages that invalidate TanStack Query
caches, positions are fetched again afterwards, depth is polled over REST every second, and prices
arrive separately in the quote store. Each path updates at its own moment, so two surfaces can show
different states for a short time. ADR 0005 also keeps all server state in TanStack Query, which
re-renders through React on every change and cannot keep up with four updates a second across
several surfaces.

The chart also gains interactions (pan, zoom, drag an order line, drag a stop line, place, tap the
position) that compete for one finger on a phone.

## Decision

1. **The paper engine is the only authority** for orders, fills, positions and trailing stops. The
   trailing logic is a pure step function in `packages/paperEngine`, run on every tick in tick
   order. The client never computes a live stop; it only previews one before placement with the
   same exported arithmetic.
2. **One frame per flush.** The transport sends one `accountDelta` message every 250 ms per
   connection: quotes, the focused instrument's depth, and the order, position and trailing-stop
   changes those ticks caused, tagged with a monotonically increasing engine `seq`. Command
   responses carry `seq` too, and `GET /v1/account/state` returns a consistent snapshot at one
   `seq`.
3. **A trading store in `packages/apiClient`**, framework-free like the quote store beside it, so the
   React Native app (CLAUDE.md D10) can reuse it. It applies each frame in one commit, in the same
   animation frame as the quotes; drops stale `seq`s; re-reads the snapshot on a gap or on resume;
   tracks pending intents by `clientOrderId` or request id with a 5-second timeout; and is cleared
   on sign-out. React reads it through `useTradingSelector`.
4. **Amendment to ADR 0005.** Orders, positions and trailing stops for the signed-in account are
   held in the trading store, which writes through to the TanStack Query caches so pages that read
   those queries stay consistent. The invalidate-on-`orderUpdate` path is removed. Other server
   state stays in TanStack Query.
5. **Per-tick painting skips React.** The chart overlay positions its handles from the chart's own
   repaint cycle (a series primitive's view update); React renders only when objects appear or
   disappear.
6. **Resume replays.** Each simulated instrument has its own random stream. After a frozen timer,
   the market replays the missed ticks, with timestamps, for instruments with working orders or
   active stops, so the engine steps through them as if it had never paused.
7. **Gestures by zone.** The plot pans and zooms; the price-axis gutter places orders; lines move
   only by their 44 px handles; the position chip opens the trailing-stop sheet on a tap detected by
   the chart's click event. The specification §9 gives the full model and the rejected
   alternatives.

## Consequences

- Correctness is tested in one place (the engine) and consistency in one place (the store).
- The engine snapshot moves to version 2 with `seq` and trailing stops; version 1 snapshots migrate,
  so existing demo state survives the release.
- `apps/api` and `apps/realtime` do not yet send `accountDelta` or serve trailing-stop routes. In API
  mode a capability flag hides trailing-stop controls; the Phase 2 follow-up adopts the engine on
  the server.
- DOM handles cost a transform per handle per repaint, but give real touch targets, focus and
  screen-reader labels, which a canvas-only overlay cannot.
