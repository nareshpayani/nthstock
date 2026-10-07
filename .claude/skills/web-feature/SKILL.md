---
name: web-feature
description: Add or extend a feature in apps/web (components, hooks, queries, store, strings, mocks, tests) following ADR 0005. Use when building any nthstock frontend story.
---

# Build a web feature (apps/web)

ADR 0005 (`docs/adr/0005-web-ui-architecture.md`) is the source of truth; this is the checklist.

## Where things go
```
apps/web/src/features/<feature>/      camelCase folder, one per business capability
  index.ts        the only public entry: export what routes and other features may use
  components/     PascalCase .tsx, one component per file, colocated *.test.tsx and *.stories.tsx
  hooks/          useXxx.ts
  api/            queryOptions factories and keys shaped [feature, entity, params]; mutations
  store/          Zustand, UI-only state shared by distant components (otherwise useState)
  model/          pure TypeScript (no React), unit-tested
  strings.ts      every user-facing string of the feature
apps/web/src/routes/                  thin TanStack Router file routes: loader prefetch, then render the page
apps/web/src/shared/                  only code used by two or more features
apps/web/src/mocks/handlers/<feature>.ts   MSW handlers typed from packages/contracts
```
Presentational, reusable pieces (no data fetching) belong in `packages/ui`, not in a feature.

## Rules that CI and the Reviewer enforce
- Imports go `routes → features → shared → packages/*`. Import another feature only through its
  `index.ts`, using the `@/` alias. ESLint `no-restricted-imports` fails the build otherwise.
- Named exports only. PascalCase for component files and types, camelCase for everything else.
- Server state in TanStack Query, URL state in Zod-validated search params, UI-only state in Zustand.
- Live prices only through `useQuote` / `<PriceCell>` (`useLiveSelection` for derived values).
- Styling with Tailwind classes from the token preset; no raw hex colours (a build guard checks).
- Money is integer paise from contracts, formatted with `formatInr` from `@nthstock/utils`; show IST.
- Up/down is never colour alone: ▲▼ plus text. Every interactive element is keyboard reachable.
- Forms: React Hook Form + `zodResolver` with the schema from `packages/contracts`.
- Lists over 50 rows use TanStack Virtual; charts are lazy-loaded.

## Steps
1. Read the story, its spec in `docs/specs/`, and the contract types in `packages/contracts`.
2. Add or extend the MSW handler so the feature works in msw mode.
3. Build `model/` and `api/` first with unit tests, then hooks, then components with RTL tests.
4. Add stories for new feature components; export the page component from `index.ts`.
5. Wire the route (thin) with a `pendingComponent` skeleton and an `errorComponent`.
6. Run the checks in the `quality-checks` skill, including `npm run e2e` if the journey changed.
