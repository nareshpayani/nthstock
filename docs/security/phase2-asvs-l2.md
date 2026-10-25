# Phase 2 security checklist: OWASP ASVS 4.0.3 Level 2

> Story NSTOCK-0244 (T-244), epic E21. Covers the ASVS items that Phase 2 (backend core on
> PostgreSQL, [`docs/specs/backend-core.md`](../specs/backend-core.md) §13) touches, each with the
> tests that prove it. Status as of 2026-10-25, `develop`.

Paths are relative to the repository root. "Dual-backend scenario" means the suite in
`packages/contracts/src/testing/scenarios/` runs against MSW (`apps/web/src/mocks`) and against
`apps/api` on Postgres and Redis (`apps/api/src/test/scenarios.test.ts`), both in CI.

Legend: **Met** (implemented and tested), **Partly** (implemented, a gap is named), **Later** (a
later phase owns it).

## Authentication (V2)

| ASVS | Requirement | Status | How it is met | Tests |
|---|---|---|---|---|
| 2.2.1 | Anti-automation | Met | Per-IP and per-user limits on OTP, PIN, step-up and TOTP verify; CAPTCHA after 3 failures; an OTP or TOTP challenge dies after 5 wrong codes | [`rateLimits.test.ts`](../../apps/api/src/modules/auth/rateLimits.test.ts), [`otpService.test.ts`](../../apps/api/src/modules/auth/otpService.test.ts), [`otpRedis.integration.test.ts`](../../apps/api/src/modules/auth/otpRedis.integration.test.ts), scenario "totp login: a PIN login needs the code too; five wrong codes end the challenge" ([`twoFactor.ts`](../../packages/contracts/src/testing/scenarios/twoFactor.ts)) |
| 2.4.1 | Passwords (PINs) stored with an approved one-way function | Met | PINs hashed with Argon2id and a salt; 5 wrong PINs lock, counted in one `UPDATE … RETURNING` | [`pinHasher.test.ts`](../../apps/api/src/modules/auth/pinHasher.test.ts), [`pin.test.ts`](../../apps/api/src/modules/auth/pin.test.ts), auth conformance suite [`repo.test.ts`](../../apps/api/src/modules/auth/repo.test.ts) (5 concurrent wrong PINs count to 5) |
| 2.6.1, 2.6.2 | Look-up secrets single use, enough entropy, hashed | Met | 10 recovery codes of 80 bits, Argon2id with salt, `used_at` set atomically | [`repo.test.ts`](../../apps/api/src/modules/auth/repo.test.ts), scenario "totp login: a recovery code works once, typed in any case", [`twoFactor.spec.ts`](../../apps/web/e2e/twoFactor.spec.ts) |
| 2.8.1, 2.8.4, 2.8.5 | TOTP lifetime, single use, replay rejected and logged | Met | RFC 6238, 30 s step ±1, `last_used_step` refuses a replay and logs `LOGIN_FAILED` with reason `TOTP_REPLAY` | scenario "totp login: OTP then the code; a replayed code is refused, the next step works", [`repo.test.ts`](../../apps/api/src/modules/auth/repo.test.ts), RFC vectors in `packages/utils` |

## Session management (V3)

| ASVS | Requirement | Status | How it is met | Tests |
|---|---|---|---|---|
| 3.3.1 | Logout and expiry invalidate the session | Met | `revoked_at` in Postgres, the Redis revocation cache checked before Postgres, and apps/realtime closes the session's sockets with code 4401 | [`sessionRevocation.integration.test.ts`](../../apps/api/src/modules/auth/sessionRevocation.integration.test.ts), [`sessionRevocationFeed.test.ts`](../../apps/realtime/src/feeds/sessionRevocationFeed.test.ts), [`hub.test.ts`](../../apps/realtime/src/connections/hub.test.ts) |
| 3.3.3 | Offer to end other sessions after a factor change | Met | "Log out all other devices" offered after TOTP is turned on or off | [`activeSessions.spec.ts`](../../apps/web/e2e/activeSessions.spec.ts), [`securityJourney.spec.ts`](../../apps/web/e2e/securityJourney.spec.ts) |
| 3.3.4 | View and log out active sessions after re-authentication | Met | Security settings list every live session, "This device" marked; revoking needs a step-up | scenarios "sessions: …" ([`sessions.ts`](../../packages/contracts/src/testing/scenarios/sessions.ts)), [`sessions.test.ts`](../../apps/api/src/modules/auth/sessions.test.ts), [`securityJourney.spec.ts`](../../apps/web/e2e/securityJourney.spec.ts) |
| 3.5.x | Refresh-token rotation, reuse detection | Met | One atomic `useRefreshToken`; a reused token revokes the family and logs `REFRESH_REUSE_DETECTED` | [`pgRepo.integration.test.ts`](../../apps/api/src/modules/auth/pgRepo.integration.test.ts) (two concurrent uses, one winner), [`audit.test.ts`](../../apps/api/src/modules/auth/audit.test.ts) |
| 3.7.1 | Re-authenticate before sensitive actions | Met | Step-up (PIN, OTP to the own mobile, or TOTP) opens a 10-minute window; guarded routes answer `403 STEP_UP_REQUIRED` outside it | scenarios "step-up: …" ([`twoFactor.ts`](../../packages/contracts/src/testing/scenarios/twoFactor.ts)) |

## Validation and injection (V5)

| ASVS | Requirement | Status | How it is met | Tests |
|---|---|---|---|---|
| 5.1.x | Input validated against a schema | Met | Every route's body, query and response typed and validated from `packages/contracts` (Zod) | [`registerRoute.test.ts`](../../apps/api/src/http/registerRoute.test.ts), the dual-backend scenarios |
| 5.3.4 | Parameterised queries | Partly | Drizzle's query builder and `sql` tagged templates bind every value. `sql.raw` appears twice, both on fixed identifiers, never user input: the upsert's `excluded."<column>"` in `apps/api/src/modules/orders/pgRepo.ts` and a candle view name from a closed type in `apps/api/src/modules/candles/store.ts`. Gap: the lint rule that bans `sql.raw` in `src` (spec §13) is not in place; follow-up is a `no-restricted-syntax` rule with these two allow-listed. | [`pgbouncerRules.test.ts`](../../apps/api/src/db/pgbouncerRules.test.ts) (bans `PREPARE`, session `SET`, `LISTEN`) |

## Cryptography (V6)

| ASVS | Requirement | Status | How it is met | Tests |
|---|---|---|---|---|
| 6.2.1, 6.2.5 | Approved algorithms, no insecure modes | Met | AES-256-GCM with a fresh IV and the column as additional data, HMAC-SHA256 blind index, SHA-256, Argon2id; ids and codes from `crypto.randomBytes` | [`crypto.test.ts`](../../apps/api/src/db/crypto.test.ts) (round trip, tamper detection, column binding) |
| 6.4.1 | Key management | Met for this phase | Keys from env; the development keys are refused in production; each ciphertext carries a key id so keys rotate. Secrets Manager and KMS arrive in Phase 6 | [`crypto.test.ts`](../../apps/api/src/db/crypto.test.ts) ("reads a value written under an older key id", "refuses to start in production without keys"), [`config.test.ts`](../../apps/api/src/config.test.ts) |

## Logging (V7)

| ASVS | Requirement | Status | How it is met | Tests |
|---|---|---|---|---|
| 7.1.1, 7.1.2 | No credentials or PII in logs | Met | The audit detail deny list (mobile, otp, pin, code, token, secret, name, email) at any depth; OTP printed only by the mock SMS outside production; Redis keys use the blind index | [`audit/repo.test.ts`](../../apps/api/src/modules/audit/repo.test.ts), [`otpStore.test.ts`](../../apps/api/src/modules/auth/otpStore.test.ts) |
| 7.2.1 | Log authentication decisions | Met | `LOGIN_SUCCESS`, `LOGIN_FAILED`, `PIN_SET`, `PIN_LOCKED`, `LOGOUT`, `REFRESH_REUSE_DETECTED`, `SESSION_REVOKED`, exactly one entry each | [`audit.test.ts`](../../apps/api/src/modules/auth/audit.test.ts), [`pgRepo.integration.test.ts`](../../apps/api/src/modules/auth/pgRepo.integration.test.ts) |
| 7.3.3 | Protect security logs from modification | Met | `nthstock_app` may only INSERT and SELECT on `audit_log`, and a trigger rejects UPDATE and DELETE for every role, owner included | [`auditLog.integration.test.ts`](../../apps/api/src/db/auditLog.integration.test.ts) |

## Data protection (V8)

| ASVS | Requirement | Status | How it is met | Tests |
|---|---|---|---|---|
| 8.3.1 | Sensitive data sent in the body or headers, never the URL | Met | Mobile, OTP, PIN and codes travel in JSON bodies; tokens in httpOnly cookies | dual-backend auth scenarios ([`auth.ts`](../../packages/contracts/src/testing/scenarios/auth.ts)) |
| 8.3.2 | User can remove their data | Met | Consent recorded at sign-up; self-service deletion behind a step-up ends every session, blocks the mobile and schedules the purge after 30 days (purge job: E16, BullMQ). Data export is later work | scenarios "consent: …" and "deletion: …" ([`dpdp.ts`](../../packages/contracts/src/testing/scenarios/dpdp.ts)), [`users/repo.test.ts`](../../apps/api/src/modules/users/repo.test.ts), [`accountDeletion.spec.ts`](../../apps/web/e2e/accountDeletion.spec.ts), [`securityJourney.spec.ts`](../../apps/web/e2e/securityJourney.spec.ts) |
| 8.3.4 | Sensitive data identified and protected at rest | Met | Column encryption for mobile, name, email and the TOTP secret; a raw row read shows no plaintext | [`users/pgRepo.integration.test.ts`](../../apps/api/src/modules/users/pgRepo.integration.test.ts), [`auth/pgRepo.integration.test.ts`](../../apps/api/src/modules/auth/pgRepo.integration.test.ts) |

## Configuration (V14)

| ASVS | Requirement | Status | How it is met | Tests |
|---|---|---|---|---|
| 14.1.x | Least privilege for the database | Met | apps/api connects as the DML-only `nthstock_app`; migrations run as `nthstock_owner`; the purge job has its own role | [`client.integration.test.ts`](../../apps/api/src/db/client.integration.test.ts), [`auditLog.integration.test.ts`](../../apps/api/src/db/auditLog.integration.test.ts) |
| 14.4.x | Security headers | Met | CSP, HSTS, frame and content-type headers from apps/api and the web host | [`securityHeaders.test.ts`](../../apps/api/src/http/securityHeaders.test.ts), [`securityHeaders.spec.ts`](../../apps/web/e2e/securityHeaders.spec.ts) |

Other notes: local Postgres and Redis bind to `127.0.0.1` only, dev passwords live in
`.env.example` and are not secrets, gitleaks and CodeQL run in CI, and no fixture or seed holds real
user data (the demo mobile is the made-up 9000000001, D9).

## Phase 2 acceptance criteria (spec §15) and their evidence

| # | Criterion | Evidence |
|---|---|---|
| 1 | Postgres and Redis on loopback, two roles, migrations idempotent | `infra/docker-compose.yml`, CI `e2e-api` job (init.sql, `db:migrate`), [`client.integration.test.ts`](../../apps/api/src/db/client.integration.test.ts) |
| 2 | `db:check` fails on drift | CI `db:check` step, [`liveSchemaCheck.test.ts`](../../apps/api/src/db/liveSchemaCheck.test.ts) |
| 3 | A restart keeps users, sessions, watchlists, orders, holdings | [`apiRestart.spec.ts`](../../apps/web/e2e/apiRestart.spec.ts) (api mode, CI), [`restart.integration.test.ts`](../../apps/api/src/modules/orders/restart.integration.test.ts) |
| 4 | Dual-backend scenarios pass on both backends | [`scenarios.test.ts`](../../apps/api/src/test/scenarios.test.ts) |
| 5 | Money columns are `bigint` | [`paperTables.integration.test.ts`](../../apps/api/src/db/paperTables.integration.test.ts) |
| 6 | No plaintext PII in `users` | [`users/pgRepo.integration.test.ts`](../../apps/api/src/modules/users/pgRepo.integration.test.ts) |
| 7 | `audit_log` append-only for every role | [`auditLog.integration.test.ts`](../../apps/api/src/db/auditLog.integration.test.ts) |
| 8 | One audit entry per security event, no PII | [`audit.test.ts`](../../apps/api/src/modules/auth/audit.test.ts) |
| 9 | One refresh-token winner | [`auth/pgRepo.integration.test.ts`](../../apps/api/src/modules/auth/pgRepo.integration.test.ts) |
| 10 | 20 concurrent adds stop at 50 | [`watchlists/postgres.integration.test.ts`](../../apps/api/src/modules/watchlists/postgres.integration.test.ts) |
| 11 | Concurrent account commits keep the ledger sequence | [`orders/repo.test.ts`](../../apps/api/src/modules/orders/repo.test.ts) |
| 12 | A LIMIT order fills after a restart | [`restart.integration.test.ts`](../../apps/api/src/modules/orders/restart.integration.test.ts) |
| 13 | Orders stored by IST trade-date partition | [`orderPartitions.integration.test.ts`](../../apps/api/src/db/orderPartitions.integration.test.ts) |
| 14, 15 | Market-hours jobs and P&L snapshots | E16 (BullMQ jobs) |
| 16 to 19 | Step-up, TOTP, sessions | scenarios in [`twoFactor.ts`](../../packages/contracts/src/testing/scenarios/twoFactor.ts) and [`sessions.ts`](../../packages/contracts/src/testing/scenarios/sessions.ts), [`securityJourney.spec.ts`](../../apps/web/e2e/securityJourney.spec.ts) |
| 20, 21 | Consent and deletion | scenarios in [`dpdp.ts`](../../packages/contracts/src/testing/scenarios/dpdp.ts); purge after 30 days with E16 |
| 22, 23 | OpenAPI and contract tests | [`docs/api/openapi.json`](../api/openapi.json) (CI fails when stale), [`contract.test.ts`](../../apps/api/src/test/contract.test.ts) |
| 24 | `seed:demo` twice gives the same state, equal to `?demo=1` | [`seed.integration.test.ts`](../../apps/api/src/modules/demo/seed.integration.test.ts), [`seed.test.ts`](../../apps/api/src/modules/demo/seed.test.ts), [`demoSeed.test.ts`](../../apps/web/src/mocks/demoSeed.test.ts) |

Performance (spec §13, NSTOCK-0243): see [`docs/runbooks/perf-smoke.md`](../runbooks/perf-smoke.md)
for the 10,000-user report. First CI run (25 Oct 2026, PR #565): MARKET order ack p95 29.6 ms
(budget 300 ms), PIN login p95 42.1 ms (budget 200 ms), slowest query p95 0.6 ms (budget 50 ms), no
errors in 500 of each. The smoke runs on every PR but does not gate CI this phase (spec §14), so a
regression shows in the report, not as a red build.

## Owner sign-off checklist

- [ ] Demo: `MOCK_MARKET_ALWAYS_OPEN=true npm run seed:demo`, log in as 9000000001 / 123456, see the
      demo holdings and watchlists, restart apps/api, still logged in with the same data.
- [ ] Security settings: turn on two-factor, log out, log in with the authenticator code, log out
      another device, delete a test account.
- [ ] CI on `develop`: unit, Postgres integration, dual-backend scenarios, msw and api-mode E2E,
      restart and security journey specs green.
- [x] Performance smoke report within budget (order ack p95 < 300 ms, PIN login p95 < 200 ms,
      slowest query p95 < 50 ms): 29.6 ms, 42.1 ms and 0.6 ms on 25 Oct 2026.
- [ ] Open items accepted or scheduled: the `sql.raw` lint rule (5.3.4), market-hours jobs and purge
      (E16).
