---
paths:
  - "packages/**"
---

# Shared packages (packages/*)

- `src/index.ts` is each package's public API; other workspaces import `@nthstock/<name>` only, never
  a deep path (except documented subpaths such as `@nthstock/contracts/testing`).
- Packages never import from `apps/*`, and stay framework-free unless their purpose is UI
  (`ui` is React; `contracts`, `utils`, `paperEngine`, `marketData`, `apiClient` are plain TS) so the
  later React Native app can reuse them.
- `contracts` is the single source of API and WS shapes. Change a contract first, then both backends
  (api and MSW) and the scenario suites that test them.
- `paperEngine` holds the trading rules once; the API and MSW both run it. No rule duplicated elsewhere.
- `utils` owns INR formatting, IST dates and NSE market hours; never re-implement them.
- New runtime dependencies need owner approval (CLAUDE.md §8); pin exact versions (`save-exact`).
