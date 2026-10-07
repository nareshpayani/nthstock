---
paths:
  - "**/*.test.ts"
  - "**/*.test.tsx"
  - "**/*.stories.tsx"
  - "apps/web/e2e/**"
  - "**/test/**"
---

# Testing standards

| Kind | Where | Tool |
|---|---|---|
| Unit and component | beside the code, `*.test.ts(x)` | Vitest, React Testing Library, MSW node server |
| Integration (Postgres, Redis) | `*.integration.test.ts` | Vitest + Testcontainers (Docker) |
| Contract scenarios | `packages/contracts/testing`, run against API and MSW | Vitest |
| Stories and a11y | `*.stories.tsx` | Storybook test runner + axe |
| End to end | `apps/web/e2e/*.spec.ts` | Playwright (Chrome) |
| Latency | `*.latency.test.ts` | own Vitest config, not under coverage |

- Coverage threshold is 80% per package; a test must fail without the change it covers.
- No real clocks, network or randomness: use `fixedClock`/manual clocks, MSW, seeded faker.
- Shared helpers go in the package's `src/test/` (web: `src/test/`), never copied between files.
- Time-dependent UI (market open, holidays) is tested with a pinned clock for both states.
- Without Docker, set `SKIP_REDIS_INTEGRATION=1` / `SKIP_PG_INTEGRATION=1` locally; CI runs them.
