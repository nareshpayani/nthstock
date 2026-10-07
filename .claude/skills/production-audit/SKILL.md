---
name: production-audit
description: Production-readiness audit of nthstock from local evidence, ending in a score, blockers and the next fix. Use before a phase sign-off or demo, after a large merge, before the Phase 6 AWS move, or when asked "is this ready to ship" or "what breaks in prod".
---

# Production audit

Engineering triage, not a compliance certificate. Build it only from this checkout, CI results
and a local or preview URL. Never run remote scanners or `npx <pkg>@latest`, and never send code
or data to an outside service without the owner's yes.

## 1. Establish the surface
```sh
git status --short --branch && git log --oneline -20
gh run list --branch main --limit 5          # is main green, and since when
```
Read the phase in CLAUDE.md, the spec in `docs/specs/` for what is meant to ship, and
`docs/runbooks/`.

## 2. Check each lens (skip what does not exist yet, and say so)
| Lens | Look at |
|---|---|
| Auth and sessions | every `/v1` route has auth; CSRF on writes; rate limits on OTP/PIN/TOTP; session revoke reaches `apps/realtime` |
| Money integrity | order and funds writes are one transaction with a row lock and an idempotency key; paise integers end to end; audit log append-only |
| Data | migrations run forward from empty and from the last release; destructive ones have a recovery note; DPDP consent and 30-day erase work |
| Realtime | reconnect with backoff, stale-price indicator, 200-symbol cap, conflation; behaviour when Redis drops |
| Frontend | every route has `errorComponent` and a skeleton; sections in `SectionBoundary`; no believable empty value on failure (`silent-failure-hunter`); a11y spec green |
| Performance | Lighthouse CI budgets (`apps/web/lighthouserc.cjs`) and `renderPerf.spec.ts` green; initial JS < 200 KB gzipped; API p95 < 200 ms |
| Security | `securityHeaders.ts` (web and API) and its E2E; CodeQL and `npm audit --audit-level=high` clean; no secrets in the tree |
| Operations | clean-checkout start with documented commands; every env var in `.env.example` and parsed in `config.ts`; health endpoint checks Postgres and Redis; logs carry ids, never PII; rollback written down |
| Journeys | `goldenPath.spec.ts` and the main E2E specs green at 1440 and 390 widths |

For a deeper pass on changed code, run the `security-reviewer`, `frontend-reviewer` and
`silent-failure-hunter` agents on it.

## 3. Score
| Score | Band |
|---|---|
| 0–49 | Blocked: do not ship |
| 50–69 | Risky: internal demo only |
| 70–84 | Launchable with caveats the owner accepts |
| 85–100 | Strong: no blockers in the evidence |

Cap at 69 if a sensitive route lacks auth, an order or funds write can double-spend or is not
idempotent, a migration cannot run safely, a secret is exposed, or there is no rollback path.
Cap at 84 if main is red or the golden path was not run end to end.

## 4. Report
Lead with one sentence: `Production audit: 74/100, launchable with caveats: <top two risks>.`
Then `Blockers`, `High-value fixes`, `Evidence checked` (files, commands, runs),
`Evidence missing`, and one `Next action`. Green CI alone is not readiness; never give a score
without the evidence behind it. File each blocker with
`bash tools/github/issueKey.sh create --type bug` only when the owner asks.

Adapted from ECC `skills/production-audit` (MIT, see `../../third-party-notices.md`).
