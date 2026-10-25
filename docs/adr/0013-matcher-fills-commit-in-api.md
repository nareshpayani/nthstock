# 0013. The matcher finds fills, apps/api commits them

- Status: Accepted (2026-10-25, with NSTOCK-0367)
- Date: 2026-10-25
- Specification: [market-data-and-matching](../specs/market-data-and-matching.md) §5.2
- Amends: that section's step 1, where the matcher itself loads, applies and commits each fill
- Builds on: [0007](0007-postgres-persistence-and-jobs.md) (account store) and
  [0012](0012-trading-state-and-chart-gestures.md) (the paper engine is the only authority)

## Context

The matcher worker (`apps/matcher`) keeps an order book per instrument and learns from each tick
which orders cross and which stops trigger. The spec has it commit those fills itself: load the
user's account, run the paper engine, commit with the expected version and audit entries, then
publish the order update.

All of that is apps/api's orders module today: the account store (`createPgAccountStore`), the
desk of engines with its per-user write queue, the conflict reload, the audit entries and the
order updates (`createOrderService`). To commit from the matcher, that code would have to move into
a shared package, or apps/matcher would import apps/api. Packages stay free of Node and database
code so the React Native app can reuse them (`.claude/rules/packages.md`). An import between apps
would tie their builds and releases together. Keeping two copies of the commit path would break
the rule that the trading rules live in one place.

## Decision

1. **The matcher finds fills.** For each tick that crosses an order or triggers a stop, the lease
   holder writes one `MatcherFill` per user (`packages/contracts`: user, token, LTP, tick time,
   and the order and stop ids it saw) to `nthstock:matcher:fills:v1:{shard}`. If a request cannot
   be sent, the matcher puts the crossed orders back on the book at the same version, so the next
   crossing tick asks again.
2. **apps/api commits them.** Every apps/api process reads the fill streams of all shards in one
   consumer group (`api`). Each request therefore goes to exactly one process. That process runs
   it through `OrderService.applyMatcherFill`: it syncs the user's engine at the request's price
   and time (`PaperDesk.ingestFor`), then commits through the account store with the expected
   version. On a conflict it reloads and runs once more. The order updates go out after the
   commit. The process acks the request only after the commit succeeds.
3. **The engine decides.** The request is a hint. The engine re-checks every order and stop, so:
   - a request that arrives twice fills nothing twice;
   - a request for an order that was modified or cancelled since fills only what still crosses.

   This is the idempotency the spec asks of `(order_id, tick_seq)`, held by the order's own state
   and the account version, so no extra table is needed.
4. **Nothing is lost.** If a process dies holding a request it never acked, another process takes
   the request after 30 s (`XAUTOCLAIM`). A request that keeps failing stays pending, and so do
   that user's later requests, so their fills commit in order. If the matcher crashes after a
   tick crossed an order but before the request is sent, the reconcile loop (NSTOCK-0366) finds
   the order still open in Postgres and puts it back on the book.

## Consequences

- One codebase writes accounts. Fills get the same audit entries, ledger, order events and
  WebSocket updates as orders placed from the API, with no copy to keep in step.
- The matcher stays small and fast. It never waits on Postgres, and its tick loop does no I/O
  apart from one `XADD` per user per crossing tick.
- apps/api scales out for fills as it does for requests. More processes in the group commit more
  fills at once, and the shard count stays a matcher concern.
- A fill takes one extra hop, matcher → Redis → apps/api, of about a millisecond on one host. The
  NSTOCK-0370 benchmark measures tick to fill commit end to end against the 100 ms p95 target.
- In inline mode (`MATCHER_MODE=inline`, the default until NSTOCK-0369) apps/api still fills
  orders on its own ticks too. A request that arrives after such a fill finds nothing to fill.
- Triggered trailing stops follow the same path once apps/api keeps trailing stops (NSTOCK-0368).
