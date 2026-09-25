# 0001. Monorepo with npm workspaces and Turborepo

- Status: Accepted
- Date: 2026-09-25

## Context

nthstock has a web app, an API, a realtime server, a future mobile app, and shared packages
(tokens, UI, contracts, API client). They must share types and change together.

## Decision

One repository using **npm workspaces** (`apps/*`, `packages/*`) with **Turborepo** for task
orchestration and caching. Node 22 LTS pinned in `.nvmrc`; `.npmrc` enforces `engine-strict` and exact versions.

## Consequences

- One PR can change a contract and both its producer and consumer.
- Turborepo caches lint/test/build, keeping CI fast as the repo grows.
- npm (owner's choice) over pnpm: slightly slower installs and less strict dependency isolation;
  each workspace must declare every dependency it imports.
