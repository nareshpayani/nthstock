# 0008. Repository structure and Claude Code setup

- Status: Accepted
- Date: 2026-10-07
- Amends: [0005](0005-web-ui-architecture.md) (the `app/` folder list only)

## Context

After Phase 1 and half of Phase 2, the owner asked for an enterprise-grade, clean layout before
work resumes. Three places had grown flat: `apps/web/src/app` (14 files of unrelated wiring),
`apps/realtime/src` (25 files) and the root of `apps/api/src` (cross-module test suites beside the
entry files). `CLAUDE.md` had grown to 227 lines mixing product, architecture, conventions and
workflow, and `.claude/` had only agent roles and one hook, so Claude learned the standards from a
long file and found problems only in CI.

## Decision

**Source folders.**
- `apps/web/src/app/` is split by concern: `config/` (runtimeConfig, devProxy, securityHeaders),
  `live/` (liveQuotes, visibilitySync), `router/` (router, route guards), `store/` (shellStore),
  beside the existing `layouts/` and `providers/`. `queryClient.ts` and `strings.ts` stay at the root.
- `apps/realtime/src/` gets `connections/` (auth, hub, registry) and `feeds/` (quote, order and
  session-revocation feeds). Entry, config, logger, protocol and timers stay at the root.
- Cross-module test suites in `apps/api/src` (`scenarios.test.ts`, `paperEngine.test.ts`) move to
  `apps/api/src/test/`. The two T-002 "workspace resolves utils" smoke tests are removed: every
  package now imports `@nthstock/utils` for real.
- The full map lives in [docs/architecture.md §5](../architecture.md).

**Claude Code setup.**
- `CLAUDE.md` is the short index (decisions, non-negotiables, commands, pointers), keeping its
  section numbers so existing `CLAUDE.md §N` references still resolve. Product content moves to
  [docs/product.md](../product.md), architecture to [docs/architecture.md](../architecture.md).
- `.claude/rules/` holds the detailed standards, loaded by path: `frontend`, `backend`, `packages`,
  `testing`, `git-and-prs`.
- `.claude/skills/` holds repeatable procedures: `run-checks`, `local-dev`, `new-web-feature`,
  `new-api-module`.
- `.claude/hooks/` runs the CI checks while Claude edits: Prettier + ESLint after each edit,
  typecheck of changed workspaces before a turn ends, and guards against pushing to `main`,
  force-pushing, skipping checks, and editing secrets, generated files or merged migrations.
  These are Claude Code hooks, not git hooks, so D11 (no git hooks) still holds for humans.
- File names in `.claude/` are kebab-case because Claude Code requires it for skill names.

## Consequences

- Moves were made with an import-rewriting script; `npm run check` passes with the new paths.
- Agents get standards for the folder they work in, and lint or type errors surface while they edit
  rather than in CI.
- The Stop hook adds a typecheck run (cached by Turborepo) at the end of each local turn.
