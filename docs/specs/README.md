# Feature specs

CLAUDE.md §8 asks for one spec per feature, approved by the owner before code. From now on each
spec is written as `docs/specs/<feature>.md` (problem, UX, API/WS contract, acceptance criteria,
out of scope) and opened as a PR labelled `spec`; merging that PR is the owner's approval.

## Phase 1 epics (E1 to E10)

No separate spec files were written for the Phase 1 epics. Their scope and acceptance criteria are
the tasks, with their "Done when" criteria, in
[`docs/research/implementation-tasks.md`](../research/implementation-tasks.md), which the owner
merged in [PR #198](https://github.com/nareshpayani/nthstock/pull/198) on 2026-09-25. Each epic
has a GitHub issue that lists its story issues in order; a story started only when the owner moved
it to `agent:ready`.

| Epic | Title | Epic issue | Tasks |
|---|---|---|---|
| E1 | Foundation + app shell | [#43](https://github.com/nareshpayani/nthstock/issues/43) | T-001 to T-030 |
| E2 | Contracts + mock server | [#92](https://github.com/nareshpayani/nthstock/issues/92) | T-031 to T-078 |
| E3 | Auth | [#106](https://github.com/nareshpayani/nthstock/issues/106) | T-079 to T-091 |
| E4 | Dashboard | [#117](https://github.com/nareshpayani/nthstock/issues/117) | T-092 to T-101 |
| E5 | Search + stock detail | [#131](https://github.com/nareshpayani/nthstock/issues/131) | T-102 to T-114 |
| E6 | Watchlists | [#144](https://github.com/nareshpayani/nthstock/issues/144) | T-115 to T-126 |
| E7 | Order ticket + paper orders | [#159](https://github.com/nareshpayani/nthstock/issues/159) | T-127 to T-140 |
| E8 | Order book, positions, holdings, portfolio summary | [#174](https://github.com/nareshpayani/nthstock/issues/174) | T-141 to T-154 |
| E9 | Funds | [#182](https://github.com/nareshpayani/nthstock/issues/182) | T-155 to T-161 |
| E10 | E2E + quality | [#197](https://github.com/nareshpayani/nthstock/issues/197) | T-162 to T-175 |

Architecture decisions behind these epics are in [`docs/adr/`](../adr/) (notably ADR 0004, the mock
backend and paper engine, and ADR 0005, the web UI architecture).

## Phase 2 in chat numbering (CLAUDE.md §7 Phase 3, Backend core)

| Spec | Epics | Tasks | Status |
|---|---|---|---|
| [Backend core on PostgreSQL](backend-core.md) ([task list](backend-core-tasks.md)) | E11 to E21 | T-176 to T-244 | Approved 2026-09-28 (PR #236); E11 to E14 merged |
