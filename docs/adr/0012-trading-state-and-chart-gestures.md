# 0012. One trading state for every surface, and the chart gesture model

- Status: Accepted (with the spec, 2026-10-22)
- Date: 2026-10-22
- Spec: [`docs/specs/trade-from-charts.md`](../specs/trade-from-charts.md) §4 to §6
- Builds on: [0004](0004-mock-backend-and-paper-engine.md) (paper engine), [0005](0005-web-ui-architecture.md) (web UI)

## Context

Trade from Charts, the trailing stop-loss order (TSLO) and the scalper put the same orders,
positions and stops on five surfaces at once: chart lines, depth, order ticket, position strip and
scalper pad. The brief requires that they never disagree, that the stop recomputes on every tick,
and that resume from a backgrounded phone does not reset it. Today orders reach the web app as
`orderUpdate` messages that invalidate TanStack Query caches, positions are re-fetched, and ticks
arrive separately in the quote store, so two surfaces can briefly show different states.

The chart also gains interactions (pan, zoom, drag order line, drag TSLO line, place, tap position)
that compete for one finger on a phone.

## Decision

1. **The paper engine is the only authority** for orders, fills, positions and TSLOs. The trailing
   logic is a pure step function in `packages/paperEngine`, run on every tick in tick order. The
   client never computes a stop.
2. **One frame per change.** The mock socket sends the quotes of a flush together with the order,
   position and TSLO updates those ticks caused, as one `batch` message. Every update carries an
   engine `seq`.
3. **`tradingStore`** (zustand, per account) in `apps/web/src/shared` applies each batch in one
   transaction, drops stale `seq`s, re-reads on a gap or on resume, and keeps in-flight intents in a
   separate `pending` slice. Every surface reads selectors of this store.
4. **Per-tick painting skips React.** The chart overlay subscribes to the store and paints lines and
   handles in `requestAnimationFrame`; React renders only when objects appear or disappear.
5. **Resume replays.** The mock market emits missed ticks as a catch-up batch after a frozen
   timer, so the engine steps through them as if it had never stopped.
6. **Gestures by zone.** The plot pans and zooms; the price-axis gutter places orders; lines move
   only by their 44 px handles; the position chip opens the TSLO sheet on a short tap. Details and
   rejected alternatives are in the spec §6.

## Consequences

- One place to test correctness (the engine) and one place to test consistency (the store).
- The `orderUpdate`-invalidates-queries path stays for pages outside the instrument page until they
  move onto the store.
- `apps/api` and `apps/realtime` do not send `batch`, `positionUpdate` or `tslUpdate` yet; TSLO is
  mock-only until a later phase adopts the engine there.
- Handles as DOM buttons cost a little layout work per frame (transform only) but give real touch
  targets, focus and screen-reader labels, which a canvas-only overlay cannot.
