# 0005. Web UI architecture: layers, folders and patterns

- Status: Accepted
- Date: 2026-09-25

## Context

The web app (`apps/web`) is about to grow from an empty shell to 15 features built by agents, one story
at a time (epics #43 to #197). Without a fixed structure, every story would invent its own folders, data
fetching and state handling. Live prices must stay fast (tick to screen under 500 ms, INP under 150 ms),
and the later React Native app must reuse as much as possible (D10). Decisions come from Q&A round 8
(UI-01 to UI-07), where the owner accepted every recommended default.

## Decision

**Layers.** Imports only go downward: `routes → features → shared → packages/*`.
- A feature is imported only through its `index.ts`. No deep imports into another feature.
- `packages/*` never import from `apps/*`.
- `packages/ui` is presentational: props in, events out, no data fetching or business logic.
- Enforced with ESLint's built-in `no-restricted-imports` (UI-04); CI fails on a violation.

**Folders** (`apps/web/src`):
```
main.tsx
app/        providers/, layouts/ (AppShell, AuthLayout), router.ts, queryClient.ts
routes/     TanStack Router file routes (UI-01): __root.tsx, login.tsx, _app/… (authenticated)
features/<feature>/
            index.ts, components/, hooks/, api/ (queryOptions factories + keys),
            store/ (Zustand, UI-only), model/ (pure TS), strings.ts
shared/     components/, hooks/, lib/
mocks/      browser.ts, node.ts, handlers/<feature>.ts
```
Features, one per business capability (UI-02): `auth`, `dashboard`, `marketTicker`, `indices`,
`collections`, `movers`, `search`, `stockDetail`, `charts`, `watchlist`, `orderTicket`, `orders`,
`positions`, `holdings`, `funds`. Imports inside the app use the `@/` alias for `apps/web/src` (UI-06).

**Patterns.**
- Route files are thin. A `loader` prefetches with `queryClient.ensureQueryData(...)`, then the route renders the feature's page component.
- URL state (tabs, chart range, sort, filters) lives in search params validated with Zod, not in stores.
- Server state is TanStack Query only. Each feature exports `queryOptions` factories with keys shaped `[feature, entity, params]`. Mutations invalidate by key.
- UI state uses a small Zustand store per feature, only when distant components share it. Otherwise `useState`.
- Live prices use a framework-agnostic `quoteStore` in `packages/apiClient` (UI-03), flushed once per animation frame and read with `useQuote(symbol)` via `useSyncExternalStore`. Only `<PriceCell>` subscribes.
- Styling is Tailwind from the token preset only (no raw colours in components). Variants use `class-variance-authority` + `tailwind-merge` (UI-05).
- Forms use React Hook Form with `zodResolver`, reusing the schema from `packages/contracts`.
- Errors and loading: each route has an `errorComponent` and a skeleton `pendingComponent`. Query errors show inline and mutation errors as a toast. `ApiError` is typed, and its user copy comes from `strings.ts`.
- Performance: route-level code splitting, lazy-loaded charts, TanStack Virtual for lists over 50 rows, `React.memo` only on price cells and rows.
- Tests are colocated as `*.test.tsx` (RTL with the MSW node server), with unit tests for `model/`. Storybook covers `packages/ui` and feature components, feature stories running on MSW data (UI-07). Playwright covers the main journey.

## Consequences

- Every story has an obvious home. The Reviewer agent checks new code against this ADR.
- Two new dependencies are approved: `class-variance-authority` and `tailwind-merge`.
- The file-route plugin generates `routeTree.gen.ts`. It is committed and excluded from lint and format.
- The quote store and API client can move unchanged to the React Native app.
