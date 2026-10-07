---
paths:
  - "apps/web/**"
  - "packages/ui/**"
  - "packages/tokens/**"
---

# Frontend standards (apps/web, packages/ui, packages/tokens)

Source of truth: [ADR 0005](../../docs/adr/0005-web-ui-architecture.md). This file is the checklist.

## Layers and imports
- Imports only go down: `routes → features → shared → packages/*`. `app/` wires everything and is
  imported only by `main.tsx`, routes and tests. ESLint (`no-restricted-imports`) fails CI otherwise.
- A feature is imported only through its `index.ts`; never `@/features/x/components/...` from outside x.
- Features never import each other in a cycle (`scripts/checkFeatureCycles.mjs` in `lint` fails CI).
  What two features share goes in `shared/`, e.g. cross-feature query keys in `shared/lib/queryKeys.ts`.
- Use the `@/` alias for `apps/web/src`; relative imports only inside the same folder tree.
- `packages/*` never import from `apps/*`. `packages/ui` is presentational: props in, events out.

## Where code goes
| Code | Folder | Name |
|---|---|---|
| App-wide wiring | `app/config`, `app/live`, `app/router`, `app/store`, `app/layouts`, `app/providers` | camelCase / PascalCase |
| Route | `routes/` (TanStack file routes; `__root`, `_app`, `$symbol` are router syntax) | lowercase |
| Feature UI | `features/<feature>/components/` | `WatchlistRow.tsx` |
| Feature hook | `features/<feature>/hooks/` | `useWatchlists.ts` |
| Queries, mutations, keys | `features/<feature>/api/` (keys other features invalidate: `shared/lib/queryKeys.ts`) | `watchlistQueries.ts` |
| Pure logic, types | `features/<feature>/model/` | `sortRows.ts` |
| Feature UI state | `features/<feature>/store/` (Zustand, only when distant components share it) | `watchlistStore.ts` |
| UI strings | `features/<feature>/strings.ts`, one object, no inline copy | |
| Used by 2+ features | `shared/components`, `shared/hooks`, `shared/lib` | |
| Reusable design-system piece | `packages/ui/src/components` + a story | |

## Patterns
- Routes are thin: a `loader` prefetches with `queryClient.ensureQueryData`, then renders the page.
- Server state: TanStack Query only, `queryOptions` factories, keys `[feature, entity, params]`.
- URL state (tabs, ranges, sort, filters) in search params validated with Zod, not in stores.
- Live prices only via `useQuote`, `<PriceCell>` or `useLiveSelection`; never copy ticks into state.
- Styling: Tailwind classes from tokens only. No raw hex (`scripts/checkNoHex.mjs` fails CI).
  Variants with `class-variance-authority` + `tailwind-merge` (`cn`).
- Forms: React Hook Form + `zodResolver`, reusing schemas from `packages/contracts`.
- Each route has an `errorComponent` and a skeleton `pendingComponent`; each dashboard section sits
  in a `SectionBoundary`.
- Performance: lazy-load charts and heavy routes, TanStack Virtual for lists over 50 rows,
  `React.memo` only on price cells and rows. Budgets: initial JS < 200 KB gzipped, LCP < 2.0 s.

## Components
- One component per file, file named after it, named export, props type `<Name>Props`.
- Accessibility (WCAG 2.2 AA): real buttons and links, labels on inputs, visible focus, keyboard
  paths, ▲▼ plus text with every colour signal. axe runs in Storybook and E2E.
- Never edit generated files: `src/routeTree.gen.ts`, `public/mockServiceWorker.js`.
