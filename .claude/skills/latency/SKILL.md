---
name: latency
description: Measure and improve nthstock's realtime and API latency (tick to screen < 500 ms, API p95 < 200 ms, render budgets) by splitting the hot path into segments and measuring each before changing anything. Use when a latency test or budget fails, when changing the tick pump, Redis feeds, apps/realtime, the quote store or price rendering, or when asked whether prices are fast or fresh enough.
---

# Latency

Never call something fast without a number, and never make it fast by dropping validation or
hiding stale data. Targets are in CLAUDE.md §3.

## 1. Split the metric
Report p50, p95 and p99, not an average, plus what can hide behind a good number: **freshness**
(age of the newest quote on screen), throughput (quotes/s), dropped or conflated updates, socket
connect rate, and errors and reconnects under load.

## 2. Map the hot path and measure each segment
```
mock adapter tick (ts stamped) → apps/api tick pump → Redis publish → apps/realtime feed
→ conflation (4/s per symbol) → binary WS frame → browser decoder → quote store (one batch per
animation frame) → <PriceCell> paint
```
| Segment | Tool already in the repo |
|---|---|
| tick → client socket (one process pair, real Redis) | `npm run test:latency -w @nthstock/realtime` (`tickToScreen.latency.test.ts`, asserts p95 < 500 ms; needs Docker or `REDIS_TEST_URL` and a built apps/api) |
| tick → client at 1,000 sockets | `infra/k6/wsSmoke.js` (see `infra/k6/README.md`; local only, k6 binary or Docker) |
| socket → paint, long tasks, re-renders | `npm run e2e:perf` (`renderPerf.spec.ts`, `webVitals.spec.ts`) |
| page load LCP, INP, CLS, bundle | Lighthouse CI (`apps/web/lighthouserc.cjs`, `npm run lhci -w @nthstock/web`) |
| API p95 | Fastify request timing in the logs, or a short k6 HTTP script against one route; add a `*.latency.test.ts` beside the route when it becomes a budget |

Measure the segment you are about to change, before and after, on the same machine, with the
mock market forced open (`MOCK_MARKET_ALWAYS_OPEN=true`). Wall-clock numbers taken under
coverage or beside other suites measure the runner, not the code.

## 3. Fix in this order
1. Remove a round trip or a serialisation step (JSON where the binary frame exists).
2. Batch: one Redis publish per tick batch, one store update per animation frame.
3. Stop extra work: conflation before fan-out, subscriptions capped at 200 symbols, only visible
   rows re-render (`React.memo` on price cells and rows, TanStack Virtual).
4. Apply backpressure before a queue or socket buffer grows without bound (drop to the newest
   quote per symbol, never queue every tick).
5. Only then cache or move work, and show freshness: a stale-price indicator when the feed stops.

## 4. Report
`<segment>: p50 / p95 / p99 before → after (n samples, machine, mode)`, then what changed and why
it helped. Say what was not measured. Keep JWTs and secrets out of scripts, logs and results.

Adapted from ECC `skills/latency-critical-systems` (MIT, see `../../third-party-notices.md`).
