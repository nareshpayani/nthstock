---
name: new-web-feature
description: Add a new feature folder (or a new screen inside one) to apps/web following ADR 0005. Use when a story adds a new business capability or page to the web app.
---

# Add a web feature

Read `.claude/rules/frontend.md` first. A feature is one business capability (`watchlist`,
`orders`); a new screen for an existing capability goes in that feature.

1. Create `apps/web/src/features/<featureName>/` (camelCase) with only the folders you need:
   ```
   index.ts        # export the page component and anything other layers need, nothing else
   strings.ts      # export const strings = { … } as const
   api/            # <feature>Queries.ts: queryOptions factories, keys [feature, entity, params]
   components/     # <Name>.tsx + <Name>.test.tsx (+ <Name>.stories.tsx for visual pieces)
   hooks/          # use<Name>.ts
   model/          # pure functions and types, unit-tested
   store/          # Zustand, only if distant components share UI state
   ```
2. Contract first: request/response types come from `packages/contracts`; add the MSW handler in
   `src/mocks/handlers/<feature>.ts` and the API route (see `new-api-module`) for the same contract.
3. Add the route file in `src/routes/` (thin: loader → page) and run the dev server once so
   `routeTree.gen.ts` regenerates. Never edit that file by hand.
4. Tests: component tests on MSW data, unit tests for `model/`, a Playwright step in `e2e/` if the
   feature is on the main journey.
5. Run the `run-checks` skill. The import-boundary lint must pass.
