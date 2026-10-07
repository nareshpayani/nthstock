# nthstock structure and naming audit (main @ 2a47ae6, 2026-10-07)

Scope: apps/web, apps/api, apps/realtime, all packages/*, repo root. Read-only audit.
Rules checked: CLAUDE.md §5/§6, ADR 0005. Paths are relative to /home/claude/nthstock.

Note: the working tree was not clean during the audit. Someone else's uncommitted change is in progress
in `.claude/` (staged rename `.claude/hooks/session-start.sh -> sessionStart.sh`, modified
`.claude/settings.json`, untracked `.claude/hooks/{formatAndLint,guardBash,lib,protectFiles,typecheckChanged}.sh`).
The findings below are about committed `main`.

## What is already in good shape (no action)
- All 15 ADR 0005 features exist with an `index.ts` and `strings.ts`. Subfolder names are only
  `components/ hooks/ api/ store/ model/`. There are no stray files at a feature root.
- There are no deep imports into another feature (`@/features/x/...`). `shared/` never imports
  `@/features`. `features/` and `shared/` never import `@/app`.
- There are no `export default` outside stories and config. The only exception is `infra/k6/wsSmoke.js`,
  which k6 requires.
- There are no `: any` or `as any` anywhere. There are only 2 `eslint-disable` lines, each with a reason.
- I found no kebab-case or snake_case source files. The only ones are from tooling: drizzle migrations
  and `meta/`, TanStack `__root.tsx` / `_app.tsx` / `_authed.tsx`, `docker-compose.yml`,
  `packages/ui/test-runner-jest.config.js`.
- I found no PascalCase `.ts` files and no PascalCase folders.
- A grep of feature, app and shared components found no hardcoded UI text. Copy is in `strings.ts`.
- Some committed generated files are deliberate: `routeTree.gen.ts` (ADR 0005), `public/mockServiceWorker.js`
  (MSW), `apps/api/drizzle/meta/*` (drizzle-kit). All are prettier-ignored.
- Config is consistent: apps/api and apps/realtime both parse env with a Zod `EnvSchema` in `src/config.ts`,
  and web uses `app/runtimeConfig.ts`.
- Route search schemas are kept in route files on purpose. The comment says this keeps feature code
  out of the initial chunk, so it is not a "fat route".

---

## HIGH

H1. **Feature dependency cycle through barrels: `funds` <-> `orders` (plus `orderTicket`)**
- `features/orders/hooks/useCancelOrder.ts` and `useOrderUpdates.ts` import `fundsKeys` from `@/features/funds`.
- `features/funds/hooks/useResetFunds.ts` imports `ordersKeys` from `@/features/orders`.
- `funds` also imports `holdings` and `positions`. `orderTicket` imports `funds` and `orders`.
- This does not break ADR 0005's rules, but it is a circular import between features. It also loads a
  whole feature barrel just to read a query key array.
- Fix: move the cross-feature query keys to `apps/web/src/shared/lib/queryKeys.ts`
  (`fundsKeys, ordersKeys, holdingsKeys, positionsKeys`). Each feature's `api/*Query.ts` re-uses them.
  Add a cycle rule to `scripts/importBoundaries.test.mjs`, or use `import/no-cycle`.

H2. **apps/api modules deep-import each other's internals; modules have no public API**
- 14 non-test files reach into sibling internals. Some examples:
  - `modules/auth/*` imports `../users/repo.js`, `../users/pgRepo.js`, `../users/service.js`,
    `../audit/repo.js` and `../audit/schema.js`.
  - `modules/{orders,funds,portfolio,watchlists}/routes.ts` import `../auth/authenticate.js` and
    `../auth/sessionService.js`.
  - `funds/service.ts` and `portfolio/service.ts` import `../orders/service.js`.
  - `demo/seed.ts` imports `../watchlists/schema.js`.
- For a "modular monolith" (CLAUDE.md D5) this is the backend twin of ADR 0005's "only through index.ts".
- Fix: add `modules/<module>/index.ts` that exports only the public surface, and make cross-module
  imports go through it. Add an ESLint `no-restricted-imports` pattern `../*/!(index).js` in
  `apps/api/eslint.config.js`. Record it in a short ADR, or as an addendum to ADR 0007.

H3. **Placeholder test files at source roots** (smoke tests from T-002/T-064 that prove the workspace
resolves; each has no matching source file)
- `apps/api/src/sharedUtils.test.ts`, `apps/api/src/paperEngine.test.ts`
- `apps/web/src/app/sharedUtils.test.ts`, `apps/web/src/mocks/paperEngine.test.ts`
- Fix: delete them. Typecheck, build and the real tests already cover this. If you keep them, move them to
  `apps/api/src/test/workspaceDeps.test.ts` and `apps/web/src/test/workspaceDeps.test.ts`.
- `apps/api/src/scenarios.test.ts` is a real suite. Move it to `apps/api/src/test/scenarios.test.ts`,
  next to `conformance.test.ts`. Leave `apps/web/src/mocks/scenarios.test.ts` where it is, because it
  tests `mocks/node.ts`.

H4. **README is out of date** (`README.md`)
- The workspace table leaves out `packages/contracts`, `marketData`, `paperEngine` and `utils`.
- It describes apps/api as "Fastify API (`GET /v1/health`)".
- It says `infra:up` starts "Redis 7". `infra/docker-compose.yml` actually runs redis, postgres and
  pgbouncer, and `dev:api` needs Postgres (`db:migrate`, `DB_DRIVER=postgres`). Postgres is never mentioned.
- Fix: add the 4 packages and list the apps/api modules. Document Postgres, PgBouncer and `npm run db:migrate`.

## MEDIUM

M1. **`model/` must be pure TS (ADR 0005), but some files there fetch data or read env**
- `features/dashboard/model/prefetchDashboard.ts` (queryClient prefetch) -> move to `features/dashboard/api/prefetchDashboard.ts`.
- `features/stockDetail/model/loadStockDetail.ts` (ensureQueryData) -> move to `features/stockDetail/api/loadStockDetail.ts`.
- `features/auth/model/devOtp.ts` reads `import.meta.env` directly. Expose the flag through
  `app/runtimeConfig.ts` instead (see M7).

M2. **`store/` is for Zustand UI state (ADR 0005), but `features/auth/store/trustedDevice.ts` is localStorage
persistence** (no Zustand). Move it to `features/auth/model/trustedDevice.ts` and delete the
`auth/store/` folder.

M3. **Duplicate server cache for the same endpoints**
- `features/orderTicket/api/ticketQueries.ts` (`['orderTicket','instrument'|'quote'|'stats'|'depth',…]`) and
  `features/stockDetail/api/stockDetailQueries.ts` (`stockDetailKeys.instrument|quote|stats|depth`) both call
  `instrument` and `marketQuotes`. When the ticket opens on a stock page, it refetches data that is
  already cached.
- Fix: create one `shared/api/instrumentQueries.ts`. Shared is allowed to hold `queryOptions` factories;
  if you prefer, add `shared/api/` to ADR 0005. Both features use it with one key family `['market', entity, params]`.

M4. **`shared/` holds code that one feature owns**
- Only these are feature-specific, and each has a better home:
  - `shared/components/PlaceholderPage.tsx` is **unused** (no importers). Delete it.
  - `shared/lib/fillToasts.ts` (dedupe set) has almost the same name as `features/orders/model/fillToast.ts`
    (toast builder). Rename it to `shared/lib/fillToastClaims.ts`.
  - The session core is `shared/lib/{sessionClient,sessionStore,requireSession}.ts` and `shared/hooks/useSession.ts`.
    It sits next to `features/auth/components/RequireSession.tsx`, which has the same name but is a
    different thing. Keep the core in shared, since routes and many features use it, but group it as
    `shared/session/{sessionClient,sessionStore,requireSessionGuard,useSession}.ts`, so the route guard and
    the component no longer share a name.
- Deliberate, keep: `ticketIntentStore`, `useOpenTicket`, `searchFocusStore`, `SearchStocksButton` and
  `orderUpdatesContext`. They are cross-feature coordination points that exist to avoid feature cycles.
  Add one line about them in ADR 0005, "shared holds cross-feature coordination stores".

M5. **apps/api module layout deviates from `{routes, service, repo, schema, *.test}`**
| Module | Deviation | Proposed fix |
|---|---|---|
| `auth` (27 files) | No `service.ts`/`schema.ts`. Split into otp/pin/session services plus 15 helpers, flat. | Group as `auth/{routes.ts, index.ts, otp/, pin/, sessions/, tokens/ (accessToken, jwtSecret, sessionCookies), repo.ts, pgRepo.ts, views.ts}` |
| `auth` tests | Names don't match their source: `pin.test.ts` (pinService), `sessions.test.ts` (routes + sessionService), `otpStore.test.ts` (no `otpStore.ts`; source is `redisOtpStore.ts`), `sessionRevocation.integration.test.ts` vs `sessionRevocations.ts`, `audit.test.ts` (no audit.ts) | Rename to `pinService.test.ts`, `sessionRoutes.test.ts`, `redisOtpStore.test.ts`, `sessionRevocations.integration.test.ts`, `authAudit.test.ts` |
| `audit` | Internal (no routes/service) and has `detail.ts`. OK as an internal module. | Add `index.ts` |
| `market`, `health` | Only `routes.ts`. `health/ready.integration.test.ts` has no `ready.ts`. | Rename to `routes.integration.test.ts` |
| `funds`, `portfolio` | No repo. They read through `orders/service.js`. | Fine once H2 adds `orders/index.ts`. |
| `orders` | `audit.test.ts` (no audit.ts). `repo.ts` has no unit test. | Rename to `ordersAudit.test.ts`. Add `repo.test.ts`. |
| `users` | No routes/schema. `service.ts` has no test. | Add `service.test.ts` (80% gate). |
| `watchlists` | `postgres.integration.test.ts`, but `audit`, `auth` and `users` use `pgRepo.integration.test.ts` | Rename to `pgRepo.integration.test.ts` |
| `demo`, `testControls` | `seed.ts` / `offsetClock.ts` only | OK (tooling modules); add `index.ts` |
- The term `schema` is ambiguous. `modules/*/schema.ts` holds TS record types ("stored shapes"), while
  `src/db/schema/*.ts` holds Drizzle tables, and CLAUDE.md implies Zod. Either rename module files to
  `records.ts`, or document in CLAUDE.md §5 that module `schema.ts` = stored record types, Zod = contracts,
  and Drizzle = `db/schema/`.

M6. **Duplicated test and config scaffolding across workspaces**
- `apps/api/src/test/testRedis.ts` and `apps/realtime/src/test/testRedis.ts` are byte-identical.
  Move the file to `packages/contracts/src/testing/testRedis.ts`, or create a new `packages/testing` (needs owner OK).
- The `Flag` Zod helper is copied in `apps/api/src/config.ts` and `apps/realtime/src/config.ts`. Move it to
  `packages/utils/src/env.ts` (`envFlag`).
- 9 near-identical `vitest.config.ts` files (`packages/*`, `apps/api`, `apps/realtime`). CLAUDE.md §5 says
  `packages/config` holds "vitest presets", but there are none. See R2.

M7. **Env reads outside the config modules**
- `apps/web/src/main.tsx:40` (`VITE_TEST_CONTROLS`) and `:72` (`VITE_API_MODE`) bypass the
  `parseRuntimeConfig` result created on line 21. Use `config.testControls` / `config.apiMode`.
- `features/auth/model/devOtp.ts:9` (see M1).
- `apps/api/src/db/migrateCli.ts:8` reads `DATABASE_MIGRATION_URL` directly. This is acceptable for a CLI,
  but adding it to the CLI's own Zod schema in `config.ts` would make it consistent.

M8. **packages/ui grouped stories and tests don't follow one file per component**
- `components/Display.stories.tsx` and `components/display.test.tsx` cover ChangeBadge, Sparkline,
  Skeleton and States. The two names differ in case.
- `components/Overlays.stories.tsx` and `components/overlays.test.tsx` cover Dialog/Sheet,
  DropdownMenu, Tooltip, Toast and **Tabs**, which is not an overlay.
- Fix: split them into `ChangeBadge.{stories,test}.tsx`, `Sparkline.*`, `Skeleton.*`, `States.*`, `Dialog.*`,
  `DropdownMenu.*`, `Tooltip.*`, `Toast.*` and `Tabs.*`.
- These components have no story at all: `Input`, `NumberInput`, `OtpInput`, `IconButton`, `Switch`, `Tabs`
  (only in tests), `Spinner`, `Tooltip`. Storybook is the design source (D8).
- `src/icons/index.ts` is a dead barrel. `src/index.ts` re-exports `./icons/icons.js` and `./icons/createIcon.js`
  directly. Delete it, or make `src/index.ts` export from `./icons/index.js`.

M9. **Story and test names that don't match a component** (apps/web)
- `features/auth/components/Login.stories.tsx` -> rename to `LoginPage.stories.tsx`.
- `features/stockDetail/components/StockDetailRoute.test.tsx` has no `StockDetailRoute` component.
  Rename to `StockDetailPage.route.test.tsx`, or move it to `apps/web/src/app/` with the other route tests.
- `features/positions/components/PositionsPage.renders.test.tsx` uses a different suffix style. Use
  `PositionsPage.renderCount.test.tsx`, or merge it into `PositionsPage.test.tsx`.

## LOW

L1. **The `api/` file naming varies**: `*Query.ts` (fundsQuery, holdingsQuery, candlesQuery, listQuery…) vs
`*Queries.ts` (`stockDetail/api/stockDetailQueries.ts`, `orderTicket/api/ticketQueries.ts`). Pick
`<feature>Queries.ts` everywhere. That means renaming 10 files and keeping `index.ts` exports stable.
- `watchlist/api/watchlistsQuery.ts:29` builds an inline key `['watchlist','quotes',…]` instead of using
  `watchlistKeys`. Add `watchlistKeys.quotes(...)`.

L2. **apps/realtime/src is flat** (12 source files + 13 tests, about 2.9k lines). It is manageable today. When
it grows, group it as:
```
src/server.ts  src/app.ts  src/config.ts
src/connections/  hub.ts registry.ts protocol.ts auth.ts (+ tests)
src/feeds/        feed.ts orderFeed.ts sessionRevocationFeed.ts (+ tests, *.integration.test.ts)
src/lib/          logger.ts timers.ts
src/test/         (unchanged) + tickToScreen.latency.test.ts
```
- Also rename `sessionRevocation.test.ts` / `.integration.test.ts` to `sessionRevocationFeed.*` to match the source.

L3. **apps/web/src/mocks mixes 4 concerns.** ADR 0005 lists only `browser.ts, node.ts, handlers/`. Proposal:
- `mocks/storybook/{storyApi,storyAuth,storyMarket}.tsx`
- `mocks/worker/{workerControl,workerKeeper}.ts`
- `mocks/demo/{demoParam,demoSeed}.ts`
- Keep `handlerKit`, `marketAdapter` and `testControls` at the root.
- Handler files are named by API area (`market`, `orders`, `quoteStream`), not `handlers/<feature>.ts`. Update
  the ADR text to say "per API area".

L4. **paperEngine test helper naming** differs between three packages: `packages/paperEngine/src/testHarness.ts`,
`packages/marketData/src/testing.ts` and `packages/contracts/src/testing/`. Standardise on
`src/testing/index.ts`, exported as the `./testing` subpath.
- paperEngine also has behaviour tests with no matching source (`amo.test.ts`, `eod.test.ts`, `reset.test.ts`,
  `snapshot.test.ts`, `engineInvariants.test.ts`). They test `paperEngine.ts`/`paperDesk.ts`. Either
  rename them to `paperEngine.amo.test.ts` etc., or note the convention.

L5. **`routes/dev/prices.tsx`** (82 lines) holds a full test page with hardcoded English ("Live prices",
"Stress watchlist"). It is dev-only, so this is acceptable. If you want routes kept thin, move the page to
`shared/components/dev/LivePricesTestPage.tsx`.

L6. `apps/web/src/app/layouts/LeftRail.tsx` and `ShortcutHelpDialog.tsx` have no tests. `shared/components/{Card,PageHeader,SkeletonRows,StockRow,SearchStocksButton}.tsx`
and `shared/hooks/{useLiveSelection,useOpenTicket,useSession}.ts` have no colocated tests either.

---

## REPO LEVEL

R1. **`.gitignore` gap**: `.claude/worktrees/` is ignored only through `.git/info/exclude`, which is local to
this clone. 8 agent worktrees sit under it right now. A fresh clone or CI runner would show them as untracked.
Fix: add `.claude/worktrees/` (and `*.tsbuildinfo` as a precaution) to `.gitignore`.

R2. **`packages/config` doesn't match CLAUDE.md §5** ("eslint, tsconfig, prettier, vitest presets")
- It contains only `eslint.config.js` and 3 tsconfigs. Prettier config is at the root (`.prettierrc.json`),
  and there is no vitest preset (see M6).
- `package.json` has **no scripts**, so turbo never lints or typechecks its own `eslint.config.js`.
- Fix: add `vitest.base.ts` (exported as `./vitest`) with the shared coverage thresholds, and add
  `"lint": "eslint ."`. Either move prettier into it (`./prettier`, referenced from the root `package.json`
  `"prettier"` key) or change §5 to say prettier lives at the root.

R3. **§5 tree vs reality**
- `infra/` contains `docker-compose.yml, k6/, pgbouncer/, postgres/`. There is no `terraform/`, which is
  expected because it is a Phase 6 deliverable. Update §5 to `infra/ docker-compose, k6, pgbouncer, postgres; terraform (Phase 6)`.
- `apps/mobile/` doesn't exist. §5 already marks it "(later)", so this is OK.
- `docs/runbooks/` has only `local-demo.md`. `tools/research/` has only `paytmCapture.mjs`. Both are fine;
  §5 is accurate.
- §5 doesn't mention `apps/api/src/db/` (Drizzle schema, migrations CLI) or `apps/api/drizzle/`
  (generated migrations). Add both lines.
- `apps/web/src/` has `routeTree.gen.ts` and `viteEnv.d.ts`, which §5 doesn't show. That is fine;
  optionally mention `routeTree.gen.ts`.

R4. On committed main, `.claude/hooks/session-start.sh` is kebab-case, which breaks the camelCase rule. The
in-progress working-tree change renames it to `sessionStart.sh`. Make sure that rename is committed
(owner-merged, since it touches `.claude/`).

---

## Suggested fix order
1. H1 + H2 (boundaries), then add the lint rules that enforce them.
2. H3, M1, M2, M4 (moves, deletes and renames inside apps/web and apps/api; mechanical).
3. H4 + R2 + R3 (docs and config package), as one `chore/` PR, plus a `.gitignore` PR for R1.
4. M3, M5 (auth regroup), M6, M8.
5. Low items when the files are next touched.
