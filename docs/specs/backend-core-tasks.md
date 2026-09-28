# Backend core: task list (E11 to E21)

> Status: draft for owner review, 2026-09-28. Spec: [`backend-core.md`](backend-core.md). Phase: "Phase
> 2" in the project chat's numbering, CLAUDE.md §7 Phase 3 (Backend core). Continues the numbering of
> [`docs/research/implementation-tasks.md`](../research/implementation-tasks.md) (E1 to E10, T-001 to
> T-175).

## How to use this list

The rules of `implementation-tasks.md` apply unchanged: work top to bottom, a task starts only when
every ID in its `Depends:` field is done, one task per commit, `npm run check` green after every task,
tick the box in the PR that completes it. The Planner groups 3 to 8 consecutive tasks of one epic
into one story and PR. No task starts before the owner approves the spec by merging its PR.

Dependencies not named in CLAUDE.md §4 (`pg`, `@types/pg`, optionally `qrcode`) are listed in spec
§17 and need the owner's OK before the task that adds them.

**File format (machine-readable)**

- Each epic heading is `## E<n>: <title>`; each epic becomes a GitHub epic.
- Each task is one line:
  `- [ ] T-NNN [TRACK] Title. Depends: T-NNN, T-NNN. Done when: criteria.`
  `Depends:` lists explicit IDs (no ranges) or `none`. IDs below T-176 refer to done tasks in
  `implementation-tasks.md`.

**Track tags**

| Tag      | Meaning                                                                                                      |
|----------|--------------------------------------------------------------------------------------------------------------|
| `[BE]`   | Backend: `apps/api` (modules, db schema and migrations, repos, jobs, worker), `apps/realtime`, `packages/paperEngine` |
| `[FE]`   | Frontend UI in `apps/web` or `packages/ui`                                                                   |
| `[INT]`  | Shared glue: contracts, utils, MSW handlers kept in parity with apps/api, API client, config, infra, CI, docs, ADRs |
| `[TEST]` | Test harnesses, scenario suites, contract tests, E2E, performance checks                                     |

**Definition of done (every task)**

Everything in the definition of done of `implementation-tasks.md`, plus:

- Postgres repos pass the same conformance suite as their memory twin (T-183).
- Money columns are `bigint` paise; times are `timestamptz` in UTC; trade dates are IST `date`.
- Schema changes come with a committed migration and `npm run db:check` is clean.
- No PII, OTP, PIN, TOTP code or token in logs, audit detail or Redis keys.
- Behaviour visible over REST is the same in `msw` and `api` mode, checked by the dual-backend
  scenario suites.

## E11: Postgres foundation

- [x] T-176 [INT] Write ADR 0007 "Postgres persistence and jobs": Postgres as record and Redis for short-lived state, the account store with the engine as a cache and the single-writer simplification, orders partitioned by IST trade date, PII column encryption, audit enforcement, the worker entry and JOBS_MODE, and the new dependencies. Depends: none. Done when: docs/adr/0007-postgres-persistence-and-jobs.md has Status, Context, Decision and Consequences and the owner's decision is recorded in the PR.
- [x] T-177 [INT] Add Postgres 16 to infra/docker-compose.yml (loopback only, named volume, healthcheck) with infra/postgres/init.sql creating the nthstock_owner, nthstock_app and nthstock_purge roles, and DATABASE_URL and DATABASE_MIGRATION_URL in .env.example. Depends: T-176. Done when: npm run infra:up reports Postgres healthy and psql connects as nthstock_app but CREATE TABLE is refused.
- [x] T-178 [BE] Add drizzle-orm and pg to apps/api with src/db/client.ts (one Pool, PG_POOL_MAX, a transaction helper that runs SET LOCAL statement_timeout) and DATABASE_URL validation in config. Depends: T-177. Done when: config rejects a non-postgres URL (test) and a smoke query runs against the compose database.
- [x] T-179 [BE] Add the migration pipeline: drizzle.config.ts, db:generate, db:migrate (owner URL), db:check, and a baseline migration setting default privileges (DML for nthstock_app, DDL for the owner only). Depends: T-178. Done when: db:migrate on an empty database succeeds, a second run changes nothing, and db:check is clean.
- [x] T-180 [TEST] Add the Testcontainers Postgres helper (postgres:16-alpine through the existing GenericContainer, POSTGRES_TEST_URL override, SKIP_PG_INTEGRATION=1 printed and skipped like Redis): migrate once per worker, truncate as owner between tests. Depends: T-179. Done when: an integration test creates, migrates and truncates a database, and the skip flag shows as skipped tests.
- [ ] T-181 [INT] Add a postgres:16-alpine service to the CI jobs that run apps/api tests and the api-mode E2E, plus a db:check step. Depends: T-180. Done when: CI runs the Postgres integration tests (none skipped) and a schema edit without a migration fails CI.
- [ ] T-182 [BE] Add DB_DRIVER=memory|postgres to createDeps (memory for unit tests, postgres for dev:api and E2E) and GET /v1/health/ready checking Postgres and Redis. Depends: T-178. Done when: ready answers 503 with Postgres stopped and 200 with it up (test), and existing unit tests still run on memory.
- [ ] T-183 [TEST] Add the repo conformance harness: one shared suite per repo interface that runs against the memory and the Postgres implementation. Depends: T-180. Done when: a sample suite runs twice (memory, postgres) in the apps/api test run.
- [ ] T-184 [INT] Document the PgBouncer rules (unnamed statements, SET LOCAL only, no LISTEN/NOTIFY, no session advisory locks), add a grep test enforcing them in apps/api/src, and an optional pgbouncer service (compose profile pool, transaction mode). Depends: T-177, T-178. Done when: the grep test fails on a planted LISTEN and the integration suite passes through PgBouncer locally (noted in the PR).

## E12: Audit log

- [ ] T-185 [BE] Add the audit_log table (bigserial id, at, actor_type, actor_user_id, user_id nullable, action with a CHECK, order_id, outcome, request_id, detail jsonb) with indexes (user_id, at) and (action, at) and no foreign keys. Depends: T-179. Done when: the migration applies and db:check is clean.
- [ ] T-186 [BE] Make audit_log append-only: nthstock_app gets INSERT and SELECT only, and a BEFORE UPDATE OR DELETE trigger rejects changes for every role. Depends: T-185. Done when: integration tests show UPDATE and DELETE fail as nthstock_app and as nthstock_owner, and INSERT works.
- [ ] T-187 [BE] Make AuditRepo.append async, add appendMany(entries, tx?) and a Postgres implementation, and reject detail keys on the deny list (mobile, otp, pin, code, token, secret, name, email). Depends: T-186, T-183. Done when: the audit conformance suite passes on both implementations and a detail with a mobile key is refused (test).
- [ ] T-188 [BE] Add the auth audit actions (LOGIN_SUCCESS, LOGIN_FAILED, PIN_SET, PIN_LOCKED, LOGOUT, REFRESH_REUSE_DETECTED, SESSION_REVOKED) and write them from the OTP, PIN and session services. Depends: T-187. Done when: an OTP login, a wrong PIN, a PIN lock and a refresh reuse each write exactly one entry with no PII in detail (tests).

## E13: Users, auth and sessions on Postgres

- [ ] T-189 [BE] Add PII crypto helpers in apps/api/src/db/crypto.ts: AES-256-GCM with a key id byte, HMAC-SHA256 blind index, keys from PII_ENC_KEYS and PII_HMAC_KEY, dev defaults refused in production. Depends: T-178. Done when: tests cover round trip, tamper detection, reading a value written under an older key id, and startup failure in production without keys.
- [ ] T-190 [BE] Add the users and consents tables and PgUsersRepo: encrypted mobile, name and email, mobile_hash blind index unique among non-deleted users, mobile_last4, soft-delete columns. Depends: T-189, T-183. Done when: the users conformance suite passes on both implementations and a raw row read shows no plaintext mobile, name or email (test).
- [ ] T-191 [BE] Add the devices, device_tokens and pins tables and the Postgres device, trusted-token and PIN methods of AuthRepo, with the failure count updated in one UPDATE ... RETURNING. Depends: T-190. Done when: the auth conformance cases for devices and PINs pass on both implementations and 5 concurrent wrong PINs count to exactly 5.
- [ ] T-192 [BE] Add the sessions and refresh_tokens tables (last_seen_at, stepped_up_at, revoked_reason) and the Postgres session and refresh-token methods, with useRefreshToken as one atomic statement. Depends: T-191. Done when: two concurrent uses of one refresh token give exactly one winner (integration test) and the session conformance cases pass.
- [ ] T-193 [BE] Move OTP challenges and the resend throttle to a Redis store (TTL OTP_TTL_SEC, INCR for failures, atomic consume, keys by blind index) behind the same AuthRepo methods. Depends: T-192. Done when: the OTP conformance cases pass on memory and Redis and a challenge disappears after its TTL.
- [ ] T-194 [BE] Add the Redis session-revocation cache and the auth:sessionRevoked pub/sub event; authenticate() checks the cache before Postgres, and last_seen_at is written at most once a minute. Depends: T-192. Done when: a session revoked on one app instance is refused within 1 s on a second instance sharing Redis and Postgres (test).
- [ ] T-195 [BE] Make apps/realtime close the sockets of a revoked session on auth:sessionRevoked with close code 4401. Depends: T-194. Done when: revoking a session closes its sockets within 1 s and the same user's other session stays connected (test).
- [ ] T-196 [TEST] Run the auth scenario suite against apps/api on Postgres and Redis as well as MSW, and add the Postgres run to the scenario runner. Depends: T-182, T-188, T-190, T-191, T-192, T-193, T-194. Done when: every existing auth scenario passes unchanged on both backends in CI.

## E14: Watchlists on Postgres

- [ ] T-197 [BE] Add the watchlists and watchlist_items tables (positions with deferrable unique constraints, case-insensitive unique name per user) and PgWatchlistsRepo, whose update() runs the change in one transaction after locking the user row. Depends: T-190, T-183. Done when: the watchlists conformance suite passes on both implementations and 20 concurrent adds to a 45-item list stop at 50 (integration test).
- [ ] T-198 [TEST] Run the watchlist scenario suite against apps/api on Postgres and MSW. Depends: T-197, T-196. Done when: the suite passes unchanged on both backends in CI.

## E15: Paper accounts on Postgres

- [ ] T-199 [BE] Add a working-set snapshot (v2) to packages/paperEngine: today's and live orders, today's positions and holding sales, all holdings, and the ledger as a carried balance plus today's entries; v1 snapshots still load. Depends: none. Done when: a property test shows an engine restored from the v2 working set gives the same funds summary, positions, holdings and next actions as one restored from the full v1 snapshot, and the package has no Node-only imports.
- [ ] T-200 [BE] Add the paper_accounts (version, synced_to, opening_balance), ledger_entries (per-user seq, no UPDATE or DELETE for nthstock_app), positions, holdings, holding_sales and pnl_snapshots tables. Depends: T-179. Done when: the migration applies, a schema test asserts every money column is bigint, and UPDATE on ledger_entries fails as nthstock_app.
- [ ] T-201 [BE] Add orders and order_events partitioned by IST trade_date in a hand-written migration (daily range partitions, a DEFAULT partition, PK (trade_date, id), partial index on AMO and OPEN) and the ensure_order_partitions(from, days) function. Depends: T-200. Done when: an order for a trade date lands in its partition, a date without one lands in DEFAULT, and an order placed at 20:00 IST gets the next trading day (integration tests).
- [ ] T-202 [BE] Replace OrdersRepo with the async account store interface (load, commit with expected version and audit entries, ordersPage, orderHistory, ledgerPage, liveAccountIds, accountsTouchedOn) and a memory implementation. Depends: T-199, T-187. Done when: the memory store passes the new account-store conformance suite and every existing orders, portfolio and funds test passes.
- [ ] T-203 [BE] Implement the Postgres account store: diff an engine change into order upserts, new order events, new ledger rows, replaced position, holding-sale and holding rows and audit rows in one transaction with the optimistic version check. Depends: T-202, T-201, T-183. Done when: the conformance suite passes on Postgres, a commit with a stale version fails with AccountConflict and writes nothing, and ledger seq has no gaps under concurrent commits.
- [ ] T-204 [BE] Wire the orders service to the account store: engines hydrated on first use and kept as a cache, one reload-and-retry on conflict then 409 CONFLICT, order book, history and ledger pages read from the store, and accounts with live orders loaded at boot. Depends: T-203. Done when: a LIMIT order placed before an apps/api restart fills after it on the crossing tick with an orderUpdate published (integration test).
- [ ] T-205 [BE] Make paper account reset one transaction on Postgres: cancel live orders, clear positions and holdings, add the RESET ledger entry, bump the version, and audit it. Depends: T-204. Done when: reset restores ₹10,00,000.00, earlier ledger rows are still present, and a failure mid-reset leaves the account unchanged (test).
- [ ] T-206 [TEST] Run the order, portfolio and funds scenario suites against apps/api on Postgres and MSW. Depends: T-204, T-205, T-196. Done when: the suites pass unchanged on both backends in CI.

## E16: Jobs on BullMQ

- [ ] T-207 [BE] Add bullmq and a jobs module: queue definitions, the worker entry src/worker.ts (npm run worker), JOBS_MODE=bullmq|inline|off, cron in Asia/Kolkata, a trading-day check from packages/utils, 3 attempts with backoff, graceful shutdown. Depends: T-182. Done when: a repeatable test job runs once per scheduled time on Testcontainers Redis, skips a listed holiday, and the worker stops cleanly on SIGTERM.
- [ ] T-208 [BE] Move session events to jobs: AMO release 09:15, intraday square-off 15:20 and day close with EOD settlement 15:30, each loading the affected accounts from the store, syncing and committing; the in-process sweep stays only for JOBS_MODE=inline. Depends: T-207, T-204. Done when: with a fixed clock the jobs give the same orders, positions and holdings as the T-130 test, and a second run changes nothing.
- [ ] T-209 [BE] Add the 15:45 P&L snapshot job writing pnl_snapshots (invested, current value, day, realised and total P&L) per account touched today or holding stock. Depends: T-208, T-200. Done when: the snapshot equals the portfolio summary at close for the demo account and a rerun upserts the same row.
- [ ] T-210 [BE] Add maintenance jobs: order partitions 14 days ahead (00:30) and cleanup of expired refresh tokens, device tokens and sessions expired over 30 days (03:00). Depends: T-207, T-201, T-192. Done when: after the jobs, partitions exist for the next 14 days and expired rows are gone while live ones remain (integration tests).
- [ ] T-211 [TEST] Test every job's run(at, deps) with a fixed clock and add one BullMQ integration test for retry with backoff and a failure logged without PII. Depends: T-208, T-209, T-210. Done when: tests pass and the jobs module has at least 80% coverage.

## E17: Step-up and TOTP 2FA

- [ ] T-212 [INT] Add contracts: OtpPurpose STEP_UP, StepUpRequest and StepUpResponse, the TOTP enrol, confirm, disable, recovery-code and verify requests and responses, error codes STEP_UP_REQUIRED, TOTP_REQUIRED, TOTP_INVALID and CONFLICT, and the route map entries. Depends: none. Done when: fixtures round-trip, a recovery code must match its format, and TotpVerifyRequest needs exactly one of code or recoveryCode (tests).
- [ ] T-213 [INT] Add RFC 6238 TOTP to packages/utils on Web Crypto (HMAC-SHA1, 6 digits, 30 s, ±1 step, base32 and otpauth URI helpers). Depends: none. Done when: the RFC 6238 SHA-1 test vectors pass in Node and in jsdom.
- [ ] T-214 [BE] Add POST /v1/auth/step-up (PIN, or OTP with purpose STEP_UP) setting sessions.stepped_up_at, a requireStepUp guard with a 10-minute window, per-user rate limits, and the STEP_UP audit entry. Depends: T-212, T-192, T-188. Done when: a guarded test route answers 403 STEP_UP_REQUIRED 11 minutes after step-up and succeeds within 10 (test).
- [ ] T-215 [BE] Add the totp_factors and totp_recovery_codes tables and the enrol, confirm (10 recovery codes shown once, Argon2id-hashed), disable and regenerate routes behind step-up, with the secret encrypted and TOTP_* audit entries. Depends: T-213, T-214, T-189. Done when: enrol then confirm with a valid code sets user.totpEnabled, and raw rows show no plaintext secret or recovery code (tests).
- [ ] T-216 [BE] Add the TOTP login step: OTP or PIN verify for a TOTP user answers 401 TOTP_REQUIRED with a 5-minute Redis challenge, POST /v1/auth/totp/verify issues the session, replayed steps are refused, and 5 wrong codes end the challenge. Depends: T-215, T-193. Done when: a TOTP user gets no session without a valid code, the same code fails the second time, and a recovery code works exactly once (tests).
- [ ] T-217 [INT] Add MSW handlers for step-up and TOTP with the same rules, using the packages/utils TOTP and a documented dev behaviour. Depends: T-212, T-213, T-084. Done when: every new handler returns schema-valid responses and the TOTP_REQUIRED login branch works in msw mode.
- [ ] T-218 [TEST] Write the step-up and TOTP scenario suite for both backends. Depends: T-216, T-217, T-196. Done when: enrol, confirm, login with code, login with recovery code, replay, lockout of the challenge and disable pass against MSW and apps/api.
- [ ] T-219 [FE] Build the shared step-up dialog in features/auth (PIN, or OTP when no PIN, plus a TOTP code when enabled) that opens on 403 STEP_UP_REQUIRED and retries the mutation once. Depends: T-217. Done when: a guarded action opens the dialog, completes after a correct PIN, and focus returns to the trigger (test).
- [ ] T-220 [FE] Add the TOTP step to the login flow: 6-box code input, "Use a recovery code instead", attempts left and error states. Depends: T-217, T-088. Done when: a TOTP user logs in through the step in msw mode and a wrong code shows attempts left (component tests).
- [ ] T-221 [FE] Add the /settings/security route, the Security link in the profile menu, and the two-factor card: turn on wizard (setup key with copy, otpauth link, confirm code, recovery codes with Copy and Download .txt behind an "I have saved these codes" checkbox), regenerate and turn off. Depends: T-219, T-090. Done when: turning TOTP on and off works in msw mode, recovery codes are shown only once, and axe is clean.

## E18: Active sessions

- [ ] T-222 [INT] Add contracts ActiveSession, SessionsResponse, SessionParams and RevokeOthersResponse and the routes sessionsList, sessionRevoke and sessionsRevokeOthers. Depends: T-212. Done when: fixtures round-trip and ActiveSession has no IP address field (test).
- [ ] T-223 [BE] Implement the sessions routes: list active sessions newest activity first with current marked, revoke one other (400 for the current one), revoke all others, both revokes behind step-up, audited and published as auth:sessionRevoked. Depends: T-222, T-214, T-194. Done when: revoke-others leaves only the current session and the others' refresh tokens answer 401 (tests).
- [ ] T-224 [INT] Add MSW sessions handlers with the same rules, simulating other sessions from earlier logins in the tab. Depends: T-222, T-217. Done when: handlers return schema-valid responses and revoke-others leaves one session.
- [ ] T-225 [TEST] Write the sessions scenario suite for both backends. Depends: T-223, T-224, T-196. Done when: list, revoke one, revoke current refused, revoke others and step-up required pass against MSW and apps/api.
- [ ] T-226 [FE] Add the active sessions card: rows with device label, This device and Trusted badges, signed in and last active in IST, Log out per other row with confirm, Log out all other devices, and the offer to log out other devices after TOTP is turned on or off. Depends: T-221, T-224. Done when: logging out a row removes it, the current row has no Log out button, and axe is clean (tests).

## E19: DPDP consent and account deletion

- [ ] T-227 [INT] Add contracts: OtpVerifyRequest.consentVersion, CONSENT_POLICY_VERSION, AccountDeletionRequest and AccountDeletionResponse, error codes CONSENT_REQUIRED and ACCOUNT_DELETED, and the accountDelete route. Depends: T-212. Done when: fixtures round-trip and AccountDeletionRequest accepts only confirm DELETE (test).
- [ ] T-228 [BE] Record consent at sign-up: a new mobile without consentVersion gets 400 CONSENT_REQUIRED; with it the user, the consents row and CONSENT_GRANTED are written in one transaction. Depends: T-227, T-190, T-188. Done when: both cases are covered by tests and existing users log in without being asked again.
- [ ] T-229 [BE] Add POST /v1/account/deletion behind step-up: cancel live orders, revoke and publish every session, set deleted_at and purge_after (ACCOUNT_PURGE_AFTER_DAYS, default 30), audit it; OTP login for that mobile answers 403 ACCOUNT_DELETED with the purge date. Depends: T-227, T-214, T-194, T-204. Done when: after deletion every session answers 401 and OTP login answers 403 ACCOUNT_DELETED (tests).
- [ ] T-230 [BE] Add the daily 02:00 account purge job running as nthstock_purge: delete the user's rows from every table except audit_log, null the PII columns and set purged_at; the mobile can then sign up as a new user. Depends: T-229, T-207, T-197. Done when: an integration test that enumerates every table finds no row referencing the purged user except audit_log and the tombstone users row, and the tombstone has no PII.
- [ ] T-231 [INT] Add MSW consent and deletion handlers with the same rules (deletion clears the tab's state for that user). Depends: T-227, T-217. Done when: handlers return schema-valid responses and login after deletion answers ACCOUNT_DELETED.
- [ ] T-232 [TEST] Write the DPDP scenario suite for both backends. Depends: T-228, T-229, T-231, T-196. Done when: consent required, consent recorded, deletion behind step-up and login after deletion pass against MSW and apps/api.
- [ ] T-233 [FE] Send consentVersion from the mobile step's consent checkbox and add the "Account deletion in progress" login state. Depends: T-231, T-086. Done when: a new-user login in msw mode sends consentVersion and ACCOUNT_DELETED shows the purge date in IST (component tests).
- [ ] T-234 [FE] Add the delete account card: danger dialog explaining what is deleted and when, step-up, type DELETE, then clear the Query cache and go to /login with a notice. Depends: T-221, T-231. Done when: the dialog requires DELETE, deletion lands on /login with the notice, and axe is clean (tests).

## E20: OpenAPI and contract tests

- [ ] T-235 [INT] Generate OpenAPI 3.1 in packages/contracts from the route map with z.toJSONSchema: paths, params, query, bodies, responses, the ApiError response on every route, and cookie and bearer security schemes. Depends: T-212, T-222, T-227. Done when: every route in the map appears exactly once with its auth, and the document passes a structural test.
- [ ] T-236 [BE] Serve the document at GET /v1/docs/openapi.json (public, cacheable) and add npm run openapi writing docs/api/openapi.json. Depends: T-235. Done when: the route returns the same document the script writes (test).
- [ ] T-237 [INT] Make CI upload openapi.json as an artifact and fail when the committed docs/api/openapi.json is stale. Depends: T-236, T-181. Done when: a contract change without regenerating the file fails CI.
- [ ] T-238 [TEST] Add contract tests: every route in the map is registered in Fastify with the same method, path and auth; every scenario response validates against its route schema on both backends; every error body validates against ApiError. Depends: T-235, T-198, T-206, T-218, T-225, T-232. Done when: the tests pass in CI and an unregistered route in the map fails them.

## E21: Seed, runbook, E2E and phase sign-off

- [ ] T-239 [BE] Make the demo seed write to Postgres: idempotent upsert of the demo user by blind index with consent, watchlists and the paper account through the account store; ?demo=1 in msw mode stays equal. Depends: T-204, T-197, T-228. Done when: seeding twice gives the same state and the existing seed parity tests pass against Postgres.
- [ ] T-240 [INT] Make npm run dev:api start Postgres, migrate and start the worker; update docs/runbooks/local-demo.md and infra/README.md (start, migrate, seed, reset the database, psql, dev keys). Depends: T-239, T-207, T-179. Done when: a fresh clone reaches a seeded demo in api mode by following the runbook (noted in the PR).
- [ ] T-241 [TEST] Run the api-mode Playwright golden path in CI on Postgres and Redis services and add a restart test: restart apps/api mid-test and still see the session, watchlists, orders and holdings. Depends: T-240, T-181, T-206. Done when: both pass in CI.
- [ ] T-242 [TEST] Playwright security settings journey in msw and api mode: turn on TOTP, log out, log in with TOTP, revoke another session, delete the account; axe on each step. Depends: T-226, T-233, T-234, T-220, T-241. Done when: the journey passes in both modes in CI with zero serious or critical axe violations.
- [ ] T-243 [TEST] Add a local performance smoke on a seeded database (10,000 users): MARKET order ack, PIN login and the slowest queries from pg_stat_statements. Depends: T-204, T-196. Done when: the report shows order ack p95 < 300 ms, PIN login p95 < 200 ms and slowest query p95 < 50 ms, and is attached to the PR.
- [ ] T-244 [INT] Write the phase ASVS L2 checklist (items in spec §13 with links to tests) and prepare the phase demo: restart-persistence and security-journey recordings, screenshots of the security settings page, and an owner sign-off checklist on the phase issue. Depends: T-211, T-237, T-238, T-241, T-242, T-243. Done when: the issue has every artifact attached and is labelled for owner review.

## Summary

| Epic                                   |  Tasks |     BE |     FE |    INT |   TEST |
|----------------------------------------|-------:|-------:|-------:|-------:|-------:|
| E11 Postgres foundation                |      9 |      3 |      0 |      4 |      2 |
| E12 Audit log                          |      4 |      4 |      0 |      0 |      0 |
| E13 Users, auth and sessions           |      8 |      7 |      0 |      0 |      1 |
| E14 Watchlists on Postgres             |      2 |      1 |      0 |      0 |      1 |
| E15 Paper accounts on Postgres         |      8 |      7 |      0 |      0 |      1 |
| E16 Jobs on BullMQ                     |      5 |      4 |      0 |      0 |      1 |
| E17 Step-up and TOTP 2FA               |     10 |      3 |      3 |      3 |      1 |
| E18 Active sessions                    |      5 |      1 |      1 |      2 |      1 |
| E19 DPDP consent and account deletion  |      8 |      3 |      2 |      2 |      1 |
| E20 OpenAPI and contract tests         |      4 |      1 |      0 |      2 |      1 |
| E21 Seed, runbook, E2E and sign-off    |      6 |      1 |      0 |      2 |      3 |
| **Total**                              | **69** | **35** |  **6** | **15** | **13** |

## Out of scope for this list

- TimescaleDB and candles (Phase 4); a quote service and a dedicated matcher worker (Phase 4/5).
- AWS, Terraform, managed Postgres, replicas in use, Citus, load tests at scale (Phase 6).
- A real SMS provider; real KYC, PAN or bank data.
- Data export, consent withdrawal short of deletion, a P&L history screen, Swagger UI.
- Audit log partitioning, hash chain and write-once archive.
