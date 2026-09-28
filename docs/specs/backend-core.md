# Spec: Backend core on PostgreSQL

- Status: draft for owner review, 2026-09-28
- Phase: "Phase 2" in the project chat's numbering; CLAUDE.md §7 **Phase 3, Backend core**
- Tasks: [`backend-core-tasks.md`](backend-core-tasks.md) (E11 to E21, T-176 to T-244)
- Inputs: CLAUDE.md v0.3 (§2, §3, §4 backend stack and security baseline, §6, §7, §8),
  `docs/requirements-qa.md` (BE-04 to BE-10, SEC-01 to SEC-11, SC-04, SC-05), ADR 0002, ADR 0004,
  ADR 0006, `docs/research/implementation-tasks.md` ("Out of scope" names Postgres/Drizzle, TOTP,
  the active-sessions screen and BullMQ jobs for this phase), and the current `apps/api`,
  `apps/realtime`, `packages/contracts` and `packages/paperEngine`.

## 1. Problem

Phase 1 built the whole product on a mock backend. `apps/api` keeps every user, session, watchlist,
order and ledger entry in memory behind a `repo.ts` interface per module (ADR 0004 §3). That was the
plan for the mock phase, and it has three consequences we can no longer live with:

1. **Nothing survives a restart.** A `tsx watch` reload loses every account; `npm run seed:demo`
   re-seeds at start-up because there is nowhere to write.
2. **`apps/api` is not stateless.** CLAUDE.md §4 requires API servers that hold no state. Sessions,
   refresh-token families, PIN failure counts and paper accounts all live in one process.
3. **Promised features are missing.** Optional TOTP 2FA, the active-sessions screen (SEC-09), the
   Postgres audit log (SEC-07), BullMQ jobs (BE-10), published OpenAPI (BE-01, §7 exit criteria) and
   the DPDP consent and delete-my-account flows (SEC-11) are all in the approved v1 scope and none
   exist yet.

## 2. Goals and non-goals

### Goals

- PostgreSQL 16 + Drizzle ORM is the system of record for users, devices, PINs, sessions, refresh
  tokens, TOTP factors, consents, watchlists, paper accounts (orders, order history, ledger,
  positions, holdings) and the audit log.
- Redis 7 holds only short-lived or derived state: OTP challenges and resend throttles, rate-limit
  counters, a session-revocation cache, pub/sub, and BullMQ queues.
- Every existing module keeps its service and routes. Storage changes happen behind the repo
  interfaces; where an interface must change (orders, audit; see §5.2) the change is small and the
  in-memory implementation keeps working for unit tests.
- `VITE_API_MODE=msw|api` keeps working, and every dual-backend scenario suite passes against MSW
  and against `apps/api` on real Postgres and Redis.
- `packages/paperEngine` stays pure (no Node-only imports, no I/O). Persistence is an adapter around
  it (ADR 0004).
- New features: step-up re-authentication, optional TOTP 2FA with recovery codes, the active-sessions
  screen, consent recorded at sign-up, account deletion (soft delete + purge job), BullMQ jobs for
  session events and daily P&L snapshots, and OpenAPI generated from the Zod contracts.
- Contract tests and a Postgres service in CI; demo seed and local runbook updated.

### Non-goals (this phase)

- TimescaleDB and candle storage (Phase 4, CLAUDE.md D6).
- AWS, Terraform, managed Postgres, read replicas in use, Citus sharding (Phase 6).
- Load tests at 10 lakh users or 50k logins/sec (Phase 6). This phase only adds a small local
  performance check (§13).
- A real SMS provider, real KYC, PAN or bank data (CLAUDE.md §2, BE-07, SEC-10).
- A separate quote service or a matcher worker per instrument (Phase 4/5; see §5.3).
- Data export ("download my data") and consent withdrawal short of deletion. Listed as later work.
- A P&L history screen. Snapshots are written by a job this phase; reading them is a later spec.
- Swagger UI. Only the OpenAPI JSON is served and published.

## 3. Architecture

```
Browser (Vite SPA)                       VITE_API_MODE=msw → MSW handlers (unchanged pattern)
   │ REST /v1 (cookies, CSRF)                         │ WSS
   ▼                                                  ▼
apps/api (Fastify)  ──────── pub/sub ───────►  apps/realtime (ws)
 modules: auth, users, watchlists,   ticks, order updates,   closes sockets of revoked sessions
 orders, portfolio, funds, audit,    auth:sessionRevoked
 account, market, docs
   │ Drizzle (pg Pool, no session state; PgBouncer-ready)
   │                                   Redis 7
   ▼                                    ├─ OTP challenges, resend throttle, rate limits
PostgreSQL 16                           ├─ session-revocation cache
 ├─ roles: nthstock_owner (DDL, migrations), nthstock_app (DML only)
 ├─ users, consents, devices, device_tokens, pins, totp_*, sessions, refresh_tokens
 ├─ watchlists, watchlist_items
 ├─ paper_accounts, orders* , order_events*, ledger_entries, positions, holdings, holding_sales,
 │  pnl_snapshots                        (* partitioned by IST trade date)
 └─ audit_log (INSERT/SELECT only for nthstock_app; UPDATE/DELETE rejected by trigger)
                                        └─ BullMQ queues
apps/api worker entry (src/worker.ts, `npm run worker`) ◄──────┘
 jobs: AMO release 09:15, square-off 15:20, day close 15:30, P&L snapshot 15:45,
       order partitions, expired-token cleanup, account purge (all IST, trading-day aware)
```

- Database code lives in `apps/api/src/db/` (`client.ts`, `schema/<module>.ts`, `migrate.ts`,
  `crypto.ts`). Postgres repos sit next to the memory ones as `modules/<module>/pgRepo.ts`. No new
  workspace package: nothing outside `apps/api` touches Postgres.
- `createDeps` gains `DB_DRIVER=memory|postgres`. Unit tests default to `memory`; `npm run dev:api`,
  the scenario suites' Postgres run and the api-mode E2E use `postgres`.
- The worker is the same codebase with a different entry, so it shares repos and the paper engine.
  `JOBS_MODE=bullmq|inline|off`: `bullmq` for `dev:api` and the worker, `inline` keeps today's
  in-process sweep timer (used by tests with a manual clock), `off` for pure unit tests.

## 4. Data model

Conventions for every table:

- Ids keep today's prefixed text form (`usr_…`, `ses_…`, `dev_…`, `pe_…`) so contracts and fixtures
  do not change. Primary keys are `text`.
- Money is `bigint` paise, read with Drizzle `bigint({ mode: 'number' })` and a range check
  (values must stay within `Number.MAX_SAFE_INTEGER`, which is about ₹90 lakh crore).
- Times are `timestamptz`, written in UTC. A `trade_date` is a `date` in IST (the NSE trading day).
- Quantities are `integer`. Counters are `smallint`.
- Enums are `text` with a `CHECK` against the contract's enum, so adding a value is a one-line
  migration rather than an `ALTER TYPE`.
- Foreign keys point at `users(id)` with `ON DELETE CASCADE`, except `audit_log`, which has none.

### 4.1 Identity and auth

| Table | Key columns (type) | Constraints and indexes |
|---|---|---|
| `users` | `id text PK`, `mobile_enc bytea`, `mobile_hash bytea` (HMAC blind index), `mobile_last4 char(4)`, `name_enc bytea NULL`, `email_enc bytea NULL`, `kyc_status text`, `created_at`, `updated_at`, `deleted_at NULL`, `purge_after NULL`, `purged_at NULL` | `UNIQUE (mobile_hash) WHERE deleted_at IS NULL`; `CHECK kyc_status IN (…)`; index on `purge_after` where not purged |
| `consents` | `id bigserial PK`, `user_id`, `purpose text` (`TERMS_AND_PRIVACY`), `policy_version text`, `granted_at`, `withdrawn_at NULL` | index `(user_id, purpose)` |
| `devices` | `id text PK`, `user_id`, `label text`, `trusted bool`, `created_at`, `last_seen_at` | index `(user_id)` |
| `device_tokens` | `token_hash bytea PK` (SHA-256), `device_id UNIQUE`, `expires_at` | index `(expires_at)` for cleanup |
| `pins` | `user_id PK`, `hash text` (Argon2id), `failures smallint`, `updated_at` | `CHECK failures >= 0` |
| `totp_factors` | `user_id PK`, `secret_enc bytea`, `status text` (`PENDING`, `ACTIVE`), `last_used_step bigint NULL`, `created_at`, `activated_at NULL` | one factor per user |
| `totp_recovery_codes` | `id bigserial PK`, `user_id`, `code_hash text` (Argon2id), `used_at NULL`, `created_at` | index `(user_id) WHERE used_at IS NULL` |
| `sessions` | `id text PK` (the refresh family), `user_id`, `device_id`, `csrf_token text`, `created_at`, `last_seen_at`, `expires_at`, `stepped_up_at NULL`, `revoked_at NULL`, `revoked_reason text NULL` | index `(user_id) WHERE revoked_at IS NULL`; `revoked_reason IN (LOGOUT, USER_REVOKED, REUSE_DETECTED, ACCOUNT_DELETED, FACTOR_CHANGED)` |
| `refresh_tokens` | `token_hash bytea PK` (SHA-256), `session_id`, `expires_at`, `used_at NULL` | index `(session_id)`, `(expires_at)` |

`mobile`, `name` and `email` are encrypted at column level (SEC-05) with AES-256-GCM; each value
carries a one-byte key id so keys can rotate. Lookup by mobile uses `mobile_hash`, an HMAC-SHA256 of
the normalised number with a separate key. `mobile_last4` backs `User.mobileMasked` without a
decrypt. Keys come from `PII_ENC_KEYS` and `PII_HMAC_KEY` (`.env` locally, Secrets Manager in Phase
6); production refuses to start without them.

OTP challenges and the resend throttle are **not** tables: they live in Redis (§7.1).

### 4.2 Watchlists

| Table | Key columns | Constraints and indexes |
|---|---|---|
| `watchlists` | `id text PK`, `user_id`, `name text`, `position smallint`, `created_at`, `updated_at` | `UNIQUE (user_id, lower(name))`; `UNIQUE (user_id, position) DEFERRABLE INITIALLY DEFERRED` |
| `watchlist_items` | `watchlist_id` (cascade), `token integer`, `symbol text`, `exchange text`, `name text`, `position smallint`, `added_at` | `PK (watchlist_id, token)`; `UNIQUE (watchlist_id, position) DEFERRABLE INITIALLY DEFERRED` |

The 10-list and 50-item limits stay in the service (contracts export them); the repo makes them hold
under concurrency (§6).

### 4.3 Paper accounts

| Table | Key columns | Constraints and indexes |
|---|---|---|
| `paper_accounts` | `user_id PK`, `opening_balance bigint`, `version bigint`, `synced_to timestamptz`, `created_at`, `updated_at` | `version` for optimistic concurrency |
| `orders` (partitioned) | `id text`, `trade_date date`, `user_id`, `client_order_id NULL`, `token integer`, `symbol`, `exchange`, `side`, `type`, `product`, `qty integer`, `price bigint NULL`, `filled_qty integer`, `avg_fill_price bigint NULL`, `status text`, `status_reason text NULL`, `reject_code text NULL`, `placed_at`, `updated_at` | `PK (trade_date, id)`; index `(user_id, placed_at DESC, id DESC)`; partial index `(user_id) WHERE status IN ('AMO','OPEN')`; checks on enums, `qty >= 1`, `price % 5 = 0` |
| `order_events` (partitioned) | `id bigserial`, `trade_date`, `order_id`, `user_id`, `seq smallint`, `event text`, `status`, `at`, `qty`, `type`, `price NULL`, `fill_price NULL`, `note NULL` | `PK (trade_date, id)`; `UNIQUE (trade_date, order_id, seq)` |
| `ledger_entries` | `id text PK`, `user_id`, `seq bigint`, `type text`, `amount bigint`, `balance_after bigint`, `order_id NULL`, `description text`, `created_at` | `UNIQUE (user_id, seq)`; index `(user_id, seq DESC)`; append-only grants (§8) |
| `positions` | `user_id`, `trade_date`, `token`, `product`, `symbol`, `exchange`, book columns from `PositionBook` (bigint paise, integer qty) | `PK (user_id, trade_date, token, product)` |
| `holdings` | `user_id`, `token`, `qty integer`, `invested_value bigint`, `updated_at` | `PK (user_id, token)`; `CHECK qty > 0` |
| `holding_sales` | `user_id`, `trade_date`, `token`, `qty`, `proceeds bigint`, `realised_pnl bigint` | `PK (user_id, trade_date, token)` |
| `pnl_snapshots` | `user_id`, `trade_date`, `invested bigint`, `current_value bigint`, `day_pnl bigint`, `realised_pnl bigint`, `total_pnl bigint`, `created_at` | `PK (user_id, trade_date)` |

**Orders partitioned by day** (CLAUDE.md §4, SC-05). `orders` and `order_events` use declarative
range partitioning on `trade_date`, one partition per IST day, plus a `DEFAULT` partition so an
insert never fails when a partition is missing. The key is the IST trading day the order belongs to
(an AMO placed at 20:00 IST belongs to the next session's date). Because the partition key must be
in the primary key, there are no foreign keys into `orders`; `ledger_entries.order_id` and
`order_events.order_id` are plain columns checked in tests. A daily job creates partitions 14 days
ahead. Old partitions stay attached this phase; detaching and archiving is a Phase 6 runbook.

### 4.4 Audit log

| Table | Key columns | Constraints and indexes |
|---|---|---|
| `audit_log` | `id bigserial PK`, `at timestamptz DEFAULT now()`, `actor_type text` (`user`, `system`), `actor_user_id text NULL`, `user_id text NULL`, `action text`, `order_id text NULL`, `outcome text` (`OK`, `REFUSED`), `request_id text NULL`, `detail jsonb` | index `(user_id, at)`, `(action, at)`; `CHECK action IN (…)`; no FK, so rows outlive a purged user |

Design in §8.

## 5. Repository adapter approach

### 5.1 Principles

- Each module keeps `repo.ts` (interface + memory implementation) and gains `pgRepo.ts`. A shared
  **conformance suite** per interface runs against both, so memory and Postgres cannot drift.
- Repos take and return the stored record types already in each module's `schema.ts`. Drizzle table
  definitions do not leak into services.
- Anything that must be atomic is one repo call, implemented as one statement (`UPDATE … RETURNING`)
  or one transaction. Examples: `recordPinFailure`, `useRefreshToken`, `consumeOtpChallenge`,
  `WatchlistsRepo.update`, the paper account commit.
- Transactions use `READ COMMITTED` plus explicit row locks or version checks. Every transaction
  sets `SET LOCAL statement_timeout` (default 2 s). No session-level state, so PgBouncer transaction
  pooling works (§5.4).

### 5.2 Per module

| Module | Interface change | Postgres implementation |
|---|---|---|
| users | none | Encrypt/decrypt in the repo; `findByMobile` by blind index; soft-deleted users are invisible to `findByMobile`. |
| auth | none for callers; the memory repo splits internally | Devices, device tokens, PINs, sessions, refresh tokens in Postgres. OTP challenges and the resend throttle in Redis (`INCR` for failures, a Lua or `GETDEL`-based consume). `useRefreshToken` is `UPDATE refresh_tokens SET used_at = coalesce(used_at, $at) … RETURNING` with the old `used_at` read in the same statement, so exactly one caller wins. |
| watchlists | none | `update(userId, change)` runs in a transaction that first takes `SELECT … FROM users WHERE id = $1 FOR UPDATE`, reads the lists, runs `change`, then replaces the user's rows. Deferrable unique constraints allow reordering in one transaction. |
| audit | `append` becomes async and gains `appendMany(entries, tx?)` | Plain `INSERT`. Order and fund entries are written inside the paper account commit (same transaction). |
| orders | `OrdersRepo` (a sync `EngineRegistry`) is replaced by an async **account store** (below) | See §5.3. |

### 5.3 Paper accounts: engine as a cache, Postgres as the record

The `PaperDesk` keeps one `PaperEngine` per user and feeds it ticks. That stays. What changes is
where the engine's state comes from and goes to:

- **Account store interface** (new, replaces `OrdersRepo`):
  `load(userId) → { workingSet: PaperEngineSnapshot, version } | null`,
  `commit(userId, change, expectedVersion, auditEntries) → newVersion` (throws `AccountConflict`),
  and read queries `ordersPage`, `orderHistory`, `ledgerPage`, `liveAccountIds()`,
  `accountsTouchedOn(tradeDate)`.
- **Working set.** Loading a user's full history into an engine every time would grow without
  bound. `packages/paperEngine` gains a snapshot v2: today's orders and any live (AMO/OPEN) orders,
  today's positions and holding sales, all holdings, and the ledger as a carried balance plus
  today's entries. The engine's behaviour does not change; v1 snapshots (MSW's sessionStorage) still
  load. This is a pure change inside the package.
- **Commit.** After each engine change the service diffs before/after snapshots and the store
  writes, in one transaction: order upserts, new `order_events`, new `ledger_entries` (next `seq`),
  replaced `positions`/`holding_sales` rows for the trade date, replaced `holdings` rows, the audit
  entries, and `paper_accounts.version = version + 1 WHERE version = expectedVersion`. Zero rows
  updated means someone else wrote first: roll back, reload, re-apply the request once, then answer
  409 if it conflicts again.
- **Reads.** The order book, order history and ledger pages are read from Postgres with keyset
  pagination (cursor semantics unchanged: the id of the last item). Funds summary, positions,
  holdings and portfolio summary still come from the engine, which is always synced first.
- **Restart.** At boot the process loads every account with a live order (`liveAccountIds`) so a
  resting LIMIT still fills on the tick that crosses it.
- **Single writer (documented simplification).** Ticks are generated inside `apps/api` today
  (`ticks/tickPump.ts`) and every API process would generate its own random walk. So in this phase
  exactly one `apps/api` process runs the tick pump and matches resting orders; that is already true
  locally (D7). The version check makes a second writer (the job worker, or a second API instance
  serving requests) safe: it conflicts and reloads instead of corrupting an account. Moving matching
  into a dedicated worker fed by the Phase 4 quote service is Phase 4/5 work. See open question 1.

### 5.4 PgBouncer-ready configuration

- Driver `pg` (node-postgres) through `drizzle-orm/node-postgres`, one `Pool` per process,
  `PG_POOL_MAX` (default 10), `idleTimeoutMillis`, `connectionTimeoutMillis`.
- Only unnamed statements (Drizzle's default with `pg`), no `LISTEN/NOTIFY`, no session advisory
  locks, no `SET` outside a transaction (only `SET LOCAL`), no temp tables. These are the rules that
  make PgBouncer transaction mode safe; a lint-level test greps for `LISTEN`, `pg_advisory_lock` and
  bare `SET ` in `apps/api/src`.
- An optional `pgbouncer` service under the compose profile `pool` (transaction mode) lets a
  developer run the integration suite through it.

## 6. Migration strategy

- `drizzle-kit generate` writes SQL migrations from `apps/api/src/db/schema/*.ts` into
  `apps/api/drizzle/NNNN_<name>.sql`. Migrations are committed and reviewed like code.
- Things Drizzle cannot express are hand-written SQL migrations in the same folder: roles and
  grants, the `audit_log` trigger, partitioned tables and the `ensure_order_partitions(from, days)`
  function, deferrable constraints.
- `npm run db:migrate -w @nthstock/api` applies migrations with `DATABASE_MIGRATION_URL`
  (role `nthstock_owner`). The app connects with `DATABASE_URL` (role `nthstock_app`, DML only) and
  never runs DDL. `dev:api` migrates before starting; production (Phase 6) runs migrations as a
  separate deploy step, never on app boot.
- `npm run db:check` (drizzle-kit check plus "generate produces no new file") runs in CI and fails on
  drift between schema code and migrations.
- Rules for later changes: expand/contract (add nullable column → backfill → switch reads → drop in a
  later release); no destructive change in the same PR that stops using a column.
- There is no data to migrate from the in-memory repos. The demo seed writes the same starting state
  into Postgres (§12).
- Roles are created by `infra/postgres/init.sql` in Docker Compose and by the Testcontainers helper
  in tests; local passwords are non-secret dev values in `.env.example`.

## 7. Auth, session and TOTP flows

### 7.1 Login (existing, now persistent)

1. `POST /v1/auth/otp/request`: OTP challenge in Redis (`otp:<mobileHash>`, TTL `OTP_TTL_SEC`), resend
   throttle key with TTL 30 s. Only a hash of the OTP is stored. No mobile number in any Redis key.
2. `POST /v1/auth/otp/verify`: failures via `INCR`; CAPTCHA after 3; challenge consumed atomically.
   A new mobile needs `consentVersion` (§10). Creates the user, device and session in Postgres.
3. PIN path unchanged in behaviour: Argon2id hash in `pins`, failure count updated with
   `UPDATE … SET failures = failures + 1 RETURNING failures`, lock at 5, unlock via OTP.
4. **If the user has TOTP enabled**, steps 2 and 3 answer `401 TOTP_REQUIRED` with
   `details.challengeId` instead of a session (§7.3).
5. Session: 15-min access JWT (unchanged) + rotating refresh token (SHA-256 stored in
   `refresh_tokens`); reuse revokes the family (`revoked_reason = REUSE_DETECTED`).
6. Every success and failure writes an audit entry (§8).

### 7.2 Session revocation

- `sessions.revoked_at` is the record. Revoking also sets `sess:revoked:<id>` in Redis with a TTL
  equal to the access-token lifetime and publishes `auth:sessionRevoked {sessionId, userId}`.
- `authenticate()` checks the Redis key first, then the session row (row reads can later go to a
  replica). A revoked session's access token is refused on every API instance within one second.
- `apps/realtime` subscribes to `auth:sessionRevoked` and closes that session's sockets with code
  4401. The access JWT carries the session id already (`AccessTokenClaims`).
- `last_seen_at` is written at most once a minute per session (on refresh or authenticated request)
  to keep write load low.

### 7.3 Step-up re-authentication

Sensitive actions (revoke sessions, enrol/disable TOTP, regenerate recovery codes, delete account)
need a recent re-authentication (ASVS 3.3.4, 3.7.1):

- `POST /v1/auth/step-up` with `{ pin }`, or `{ requestId, otp }` after an OTP request with purpose
  `STEP_UP`; with TOTP enabled, a TOTP code is also required.
- Success sets `sessions.stepped_up_at`. Guarded routes answer `403 STEP_UP_REQUIRED` if it is older
  than 10 minutes. The web app opens a step-up dialog and retries once.
- The same PIN lockout, OTP throttle and CAPTCHA rules apply.

### 7.4 TOTP 2FA (optional)

- RFC 6238: HMAC-SHA1, 6 digits, 30 s step, accepts ±1 step. Implemented in `packages/utils` on Web
  Crypto (`crypto.subtle`), so apps/api and MSW share one implementation and no library is needed.
- **Enrol** (step-up): `POST /v1/auth/totp/enrol` creates a `PENDING` factor with a random 160-bit
  secret (encrypted at rest) and returns the base32 setup key and an `otpauth://` URI (issuer
  `nthstock`, account label `******3210`, never the full mobile).
- **Confirm**: `POST /v1/auth/totp/enrol/confirm { code }` activates it and returns 10 recovery
  codes once (16 base32 characters each, grouped for reading, stored Argon2id-hashed). The user is
  offered "Log out all other devices" (ASVS 3.3.3).
- **Login step**: `POST /v1/auth/totp/verify { challengeId, code | recoveryCode }` (public). The
  challenge lives 5 minutes in Redis and dies after 5 wrong codes. A code is refused if its step is
  not after `last_used_step` (replay, ASVS 2.8.4 and 2.8.5). A recovery code works once.
- **Disable** (step-up, plus a current code or a recovery code): deletes the factor and codes and
  offers to log out other devices.
- **Regenerate recovery codes** (step-up + code): replaces all unused codes.

### 7.5 Active sessions

- `GET /v1/auth/sessions`: the user's unrevoked, unexpired sessions, most recently active first,
  with device label, trusted flag, `current`, created and last-active times. No IP addresses are
  stored or shown in v1.
- `DELETE /v1/auth/sessions/:id` (step-up): revokes one other session (`USER_REVOKED`). The current
  session uses logout instead (400 if targeted).
- `POST /v1/auth/sessions/revoke-others` (step-up): revokes all but the current one, returns the
  count.

## 8. Audit log design

- **What is logged.** Existing: `ORDER_PLACE`, `ORDER_MODIFY`, `ORDER_CANCEL`, `ORDER_UPDATE`,
  `FUNDS_MOVEMENT`, `FUNDS_RESET`. New: `LOGIN_SUCCESS` (detail: method OTP, PIN or TOTP),
  `LOGIN_FAILED` (method, reason code), `PIN_SET`, `PIN_LOCKED`, `LOGOUT`, `REFRESH_REUSE_DETECTED`,
  `SESSION_REVOKED`, `STEP_UP`, `TOTP_ENABLED`, `TOTP_DISABLED`, `RECOVERY_CODE_USED`,
  `RECOVERY_CODES_REGENERATED`, `CONSENT_GRANTED`, `ACCOUNT_DELETION_REQUESTED`, `ACCOUNT_PURGED`.
- **No PII or secrets in `detail`.** No mobile, OTP, PIN, TOTP code, token or name. A failed login
  for an unknown mobile has `user_id NULL`. The repo rejects detail keys on a deny list
  (`mobile`, `otp`, `pin`, `code`, `token`, `secret`, `name`, `email`) in every environment.
- **Append-only, enforced twice.**
  1. Grants: `nthstock_app` has `INSERT, SELECT` on `audit_log` and `USAGE` on its sequence; no
     `UPDATE`, `DELETE` or `TRUNCATE`.
  2. A `BEFORE UPDATE OR DELETE` row trigger raises an exception for every role, including the owner.
  Tests reset the table as `nthstock_owner` with `TRUNCATE`, which the app role cannot run.
- **Same transaction as the change.** Order and fund entries are written in the paper account commit;
  auth entries in the same transaction as the session or PIN write where there is one.
- **Survives account purge.** `audit_log.user_id` is an opaque id, not a foreign key; a purged user's
  entries remain (see open question 2).
- `ledger_entries` gets the same grant treatment (no `UPDATE`/`DELETE` for the app role); account
  purge runs as a job with a dedicated `nthstock_purge` role that may delete ledger rows but still
  not audit rows.
- Later (not this phase): monthly partitions for `audit_log`, a hash chain for tamper evidence, and
  shipping to write-once storage in AWS.

## 9. Jobs (BullMQ on Redis)

| Job | Schedule (IST) | What it does | Idempotency |
|---|---|---|---|
| `session.amoRelease` | 09:15 trading days | Loads accounts with AMO orders, syncs each engine to 09:15, commits | Engine `synced_to` makes a rerun a no-op; job id per trade date |
| `session.squareOff` | 15:20 trading days | Syncs accounts with intraday positions or live intraday orders | same |
| `session.dayClose` | 15:30 trading days | Cancels open day orders, moves delivery buys to holdings (EOD settlement) | same |
| `pnl.snapshot` | 15:45 trading days | Writes `pnl_snapshots` for every account touched today or holding stock | Upsert on `(user_id, trade_date)` |
| `db.orderPartitions` | 00:30 daily | `ensure_order_partitions(today, 14)` | `CREATE TABLE IF NOT EXISTS` |
| `auth.tokenCleanup` | 03:00 daily | Deletes expired refresh and device tokens, and sessions expired over 30 days | Pure delete |
| `account.purge` | 02:00 daily | Purges accounts past `purge_after` (§10) | Per-user transaction; `purged_at` set last |

- Repeatable jobs use cron with `tz: 'Asia/Kolkata'`; each job checks `packages/utils` for a trading
  day and exits early on a holiday.
- Each job is a plain `run(at, deps)` function, unit-tested with a fixed clock; BullMQ only schedules
  and retries it (3 attempts, exponential backoff). Failures are logged without PII.
- Lazy sync stays: every read still syncs the engine first, so a user sees correct state even if a
  job is late. Jobs make the events happen on time for everyone, including users who are not online.
- `JOBS_MODE=inline` keeps the existing in-process sweep for tests that drive a manual clock and for
  the `/v1/__test` clock routes.

## 10. DPDP basics

- **Consent at sign-up.** The mobile step already shows a DPDP consent checkbox. Its value is now
  sent: `OtpVerifyRequest.consentVersion` (the contract exports `CONSENT_POLICY_VERSION`). Creating a
  new user without it answers `400 CONSENT_REQUIRED`. The user, the `consents` row and the
  `CONSENT_GRANTED` audit entry are written in one transaction. Existing users are not asked again
  this phase.
- **Account deletion.** `POST /v1/account/deletion { confirm: 'DELETE' }` (step-up):
  1. cancels live orders, revokes every session (`ACCOUNT_DELETED`) and publishes the revocations;
  2. sets `deleted_at` and `purge_after = now + ACCOUNT_PURGE_AFTER_DAYS` (default 30);
  3. writes `ACCOUNT_DELETION_REQUESTED`.
  Until purge, an OTP login for that mobile answers `403 ACCOUNT_DELETED` with the purge date. No undo
  in the UI this phase.
- **Purge job.** Deletes the user's consents, devices, tokens, sessions, PIN, TOTP data,
  watchlists, orders, order events, ledger, positions, holdings and snapshots; sets the `users` row's
  PII columns to NULL and `purged_at`, leaving a tombstone row with only the id and timestamps. Audit
  rows stay (no PII in them). After purge the mobile can sign up again as a new user.

## 11. API additions

All routes go into the `routes` map in `packages/contracts/src/routes.ts`, so Fastify, MSW, the API
client and OpenAPI stay in step. All state-changing routes keep the CSRF header rule.

| Route key | Method and path | Auth | Request → Response contracts |
|---|---|---|---|
| `stepUp` | `POST /v1/auth/step-up` | user | `StepUpRequest` → `StepUpResponse { steppedUpUntil }` |
| `totpEnrol` | `POST /v1/auth/totp/enrol` | user + step-up | none → `TotpEnrolResponse { setupKey, otpauthUri, expiresAt }` |
| `totpEnrolConfirm` | `POST /v1/auth/totp/enrol/confirm` | user + step-up | `TotpCodeRequest` → `TotpRecoveryCodesResponse { codes }` |
| `totpDisable` | `POST /v1/auth/totp/disable` | user + step-up | `TotpCodeOrRecoveryRequest` → `OkResponse` |
| `totpRecoveryCodes` | `POST /v1/auth/totp/recovery-codes` | user + step-up | `TotpCodeRequest` → `TotpRecoveryCodesResponse` |
| `totpVerify` | `POST /v1/auth/totp/verify` | public | `TotpVerifyRequest { challengeId, code? , recoveryCode? }` → `Session` |
| `sessionsList` | `GET /v1/auth/sessions` | user | → `SessionsResponse { sessions: ActiveSession[] }` |
| `sessionRevoke` | `DELETE /v1/auth/sessions/:id` | user + step-up | `SessionParams` → `OkResponse` |
| `sessionsRevokeOthers` | `POST /v1/auth/sessions/revoke-others` | user + step-up | none → `RevokeOthersResponse { revoked }` |
| `accountDelete` | `POST /v1/account/deletion` | user + step-up | `AccountDeletionRequest { confirm: 'DELETE' }` → `AccountDeletionResponse { purgeAfter }` |
| `healthReady` | `GET /v1/health/ready` | public | → `ReadyResponse { postgres, redis }` (503 when either is down) |
| (outside the map) | `GET /v1/docs/openapi.json` | public | the generated OpenAPI 3.1 document |

Changes to existing contracts:

- `OtpPurpose` adds `STEP_UP`.
- `OtpVerifyRequest` adds optional `consentVersion`.
- New error codes in the `ApiError` envelope: `TOTP_REQUIRED` (details `{ challengeId }`),
  `TOTP_INVALID` (details `{ attemptsLeft }`), `STEP_UP_REQUIRED`, `CONSENT_REQUIRED`,
  `ACCOUNT_DELETED` (details `{ purgeAfter }`), `CONFLICT` (paper account write conflict).
- `Session` and every existing response schema are unchanged.

**OpenAPI.** `packages/contracts` builds an OpenAPI 3.1 document from the route map with Zod 4's
built-in `z.toJSONSchema()` (paths, params, query, bodies, responses, the `ApiError` response on
every route, cookie and bearer security schemes). No extra library. `apps/api` serves it at
`/v1/docs/openapi.json`; `npm run openapi` writes `docs/api/openapi.json`, CI uploads it as an
artifact and fails if the committed copy is stale.

## 12. Web UI additions

Placement follows the reference layout (CLAUDE.md §1): account settings are reached from the profile
menu in the header, and the page sits in the normal AppShell (header and left-rail watchlist stay).

- **Profile menu** gains "Security" linking to `/settings/security`.
- **`/settings/security`** (new route under `_authed`, feature folder `features/security`), one
  column of three cards:
  1. **Two-factor authentication.** Off: explanation and "Turn on". Wizard: step-up → setup key
     (copy button) and `otpauth` link, plus a QR code if approved (open question 3) → enter a 6-digit
     code → recovery codes shown once with Copy and Download .txt and an "I have saved these codes"
     checkbox before Done → offer "Log out all other devices". On: status, "Regenerate recovery
     codes", "Turn off".
  2. **Active sessions.** Rows: device label, "This device" badge, "Trusted" badge, signed in and
     last active in IST. "Log out" per other row (confirm dialog), "Log out all other devices".
  3. **Delete account.** Danger card. Dialog explains what is deleted, that paper trading data goes
     too, and the purge date; step-up; type `DELETE`; then the app clears the Query cache and goes to
     `/login` with a notice.
- **Login flow** gains a TOTP step after OTP or PIN when the server answers `TOTP_REQUIRED`: 6-box
  code input (same component as OTP), "Use a recovery code instead", attempts left, errors. And an
  "Account deletion in progress" state for `ACCOUNT_DELETED`.
- **Mobile step** sends `consentVersion` from the existing consent checkbox.
- **Step-up dialog** (shared, in `features/auth`): PIN entry, or OTP when no PIN is set, plus a TOTP
  code when enabled. Any mutation that gets `403 STEP_UP_REQUIRED` opens it and retries once.
- Strings in each feature's `strings.ts`; WCAG 2.2 AA, axe clean, focus returns to the trigger after
  every dialog; codes use `autocomplete="one-time-code"` and `inputmode="numeric"`.
- MSW handlers implement every new route with the same rules, so the UI can be built and tested in
  `msw` mode, and the dual-backend suites cover both.

## 13. Security notes (OWASP ASVS 4.0.3 Level 2 items touched)

| ASVS | Requirement | How this phase meets it |
|---|---|---|
| 2.2.1 | Anti-automation | Existing per-IP limits extended per user to step-up and TOTP verify; CAPTCHA after 3 failures; challenge dies after 5 |
| 2.6.1, 2.6.2 | Look-up secrets single use, enough entropy, hashed | Recovery codes: 80 bits, Argon2id with salt, `used_at` set atomically |
| 2.8.1, 2.8.4, 2.8.5 | TOTP lifetime, single use, replay rejected and logged | 30 s step ±1, `last_used_step`, `LOGIN_FAILED` with reason `TOTP_REPLAY` |
| 3.3.1 | Logout and expiry invalidate the session | `revoked_at` + Redis revocation cache + realtime socket close |
| 3.3.3 | Offer to end other sessions after a factor change | Prompt after TOTP on/off |
| 3.3.4 | View and log out active sessions after re-auth | Sessions screen behind step-up |
| 3.7.1 | Re-auth before sensitive actions | Step-up, 10-minute window |
| 5.3.4 | Parameterised queries | Drizzle query builder only; raw SQL only in migrations and `sql` tagged templates (lint rule bans `sql.raw` in `src`) |
| 6.2.1, 6.2.5 | Approved algorithms, no insecure modes | AES-256-GCM, HMAC-SHA256, SHA-256, Argon2id; random ids and codes from `crypto.randomBytes` |
| 6.4.1 | Key management | Keys from env locally with dev values refused in production; Secrets Manager/KMS in Phase 6; key id in each ciphertext for rotation |
| 7.1.1, 7.1.2 | No credentials or PII in logs | Audit detail deny list; OTP only in the mock SMS dev log outside production; Redis keys use the blind index |
| 7.2.1 | Log authentication decisions | `LOGIN_SUCCESS`, `LOGIN_FAILED`, `PIN_LOCKED`, `REFRESH_REUSE_DETECTED` |
| 7.3.3 | Protect security logs from modification | Grants + trigger (§8) |
| 8.3.2 | User can remove their data | Account deletion + purge job (export later) |
| 8.3.4 (data at rest) | Sensitive data identified and protected | Column encryption for mobile, name, email, TOTP secret |

Other notes:

- Local Postgres and Redis bind to `127.0.0.1` only; dev passwords are not secrets and live in
  `.env.example`. gitleaks keeps running.
- `DATABASE_URL` for the app uses the DML-only role; a compromised app cannot alter schema or
  rewrite the audit log.
- No real user data in fixtures or seeds (D9): the demo mobile stays the made-up 9000000001.

## 14. Testing strategy

| Layer | What | Where |
|---|---|---|
| Unit | Services on memory repos (as today), crypto helpers, TOTP (RFC 6238 vectors in Node and jsdom), paperEngine v2 working set (property test: same results as v1), job `run(at)` functions | Vitest |
| Repo conformance | One suite per repo interface run against memory and Postgres (users, auth, watchlists, audit, account store) including concurrency cases | Vitest + Testcontainers `postgres:16-alpine` via the existing `testcontainers` `GenericContainer`; `POSTGRES_TEST_URL` override; `SKIP_PG_INTEGRATION=1` only for machines without Docker, like Redis today |
| Database | Migrations apply to an empty DB twice; `db:check` no drift; audit and ledger UPDATE/DELETE fail for the app role; partitions routing; purge leaves no rows referencing the user | Integration |
| Dual-backend scenarios | Every existing suite (health, auth, watchlists, orders, portfolio, funds) plus new ones (step-up, TOTP, sessions, DPDP) against MSW and against `apps/api` on Postgres + Redis | `packages/contracts/testing` scenarios |
| Contract | Every route in the map is registered in Fastify with the same method, path and auth; every scenario response validates against its route schema on both backends; every error body validates against `ApiError`; OpenAPI lists every route | Vitest |
| Realtime | Revoked session's sockets close within 1 s; other sessions stay | Integration with Redis |
| E2E | api-mode golden path in CI on Postgres + Redis services; restart persistence (restart `apps/api` mid-test); security settings journey in both modes | Playwright (Chrome) |
| Performance smoke | Local bench on a seeded DB: MARKET order ack p95 < 300 ms, PIN login p95 < 200 ms, slowest query p95 < 50 ms from `pg_stat_statements` | Script, report attached to the PR; not a CI gate this phase |

Coverage stays at 80% or more on changed packages (CLAUDE.md §6).

## 15. Acceptance criteria

1. `npm run infra:up` starts Postgres 16 and Redis 7 bound to loopback, with `nthstock_owner` and
   `nthstock_app` roles; `npm run db:migrate -w @nthstock/api` on an empty database succeeds and a
   second run changes nothing.
2. `npm run db:check` passes on `main` and fails in CI when a schema file changes without a migration.
3. With `DB_DRIVER=postgres`, restarting `apps/api` keeps users, PINs, sessions, watchlists, orders,
   ledger, positions and holdings (E2E restart test).
4. Every existing dual-backend scenario suite passes unchanged against MSW and against `apps/api` on
   Postgres + Redis in CI.
5. No money column is a float type: a schema test asserts every money column is `bigint`.
6. The `users` table holds no plaintext mobile, name or email (integration test reads raw rows).
7. As `nthstock_app`, `UPDATE` and `DELETE` on `audit_log` fail; as `nthstock_owner` the trigger
   still rejects them; `INSERT` works.
8. An OTP login, a PIN login, a wrong PIN, a PIN lock, a refresh-token reuse, an order place and a
   fund movement each write exactly one audit entry with no mobile, OTP, PIN or token in `detail`.
9. Two concurrent uses of one refresh token: exactly one succeeds, and the family is revoked.
10. Twenty concurrent watchlist adds to a list of 45 stop at 50 items; the rest get 409.
11. Two concurrent commits to one paper account: one wins, the other reloads and either succeeds on
    retry or answers 409; the ledger's `seq` has no gaps or duplicates.
12. A LIMIT order placed before an `apps/api` restart fills after the restart on the first crossing
    tick, and the user receives the `orderUpdate` frame.
13. An order placed at 20:00 IST is stored in the next trading day's partition; the partition job
    leaves partitions for the next 14 days.
14. With a fixed clock, the 09:15, 15:20 and 15:30 jobs produce the same orders, positions and
    holdings as the T-130 end-of-day test, and running any job twice changes nothing the second time.
15. The 15:45 job writes one `pnl_snapshots` row per account whose values equal the portfolio
    summary at close.
16. A guarded route answers `403 STEP_UP_REQUIRED` 11 minutes after step-up and succeeds within 10.
17. Enrol + confirm with a valid code turns TOTP on; a TOTP user cannot obtain a session from OTP or
    PIN alone; the same TOTP code is refused the second time; a recovery code works exactly once;
    5 wrong codes end the challenge.
18. The TOTP secret and recovery codes are not stored in plaintext (integration test).
19. The sessions screen lists the current session marked "This device"; "Log out all other devices"
    leaves only it, and the others' refresh tokens answer 401 and their sockets close within 1 s.
20. A new mobile without `consentVersion` gets `400 CONSENT_REQUIRED`; with it, one `consents` row and
    one `CONSENT_GRANTED` entry exist.
21. After account deletion every session answers 401, OTP login answers `403 ACCOUNT_DELETED`, and
    after the purge job no table other than `audit_log` and the tombstone `users` row references the
    user, and the tombstone has no PII.
22. `GET /v1/docs/openapi.json` returns an OpenAPI 3.1 document listing every route in the map; CI
    uploads it as an artifact and fails when `docs/api/openapi.json` is stale.
23. Contract tests pass: every route in the map is registered in Fastify with matching method, path
    and auth, and every scenario response and error validates on both backends.
24. `npm run seed:demo` run twice gives the same demo state in Postgres, equal to `?demo=1` in msw
    mode (existing seed parity tests).
25. The security settings journey (turn on TOTP, log out, log in with TOTP, revoke another session,
    delete the account) passes in Playwright in msw and api mode, axe clean.
26. `packages/paperEngine` still has no Node-only or DOM-only imports (existing guard) and its
    coverage stays at 80% or more.
27. Local performance smoke on a seeded database meets: MARKET order ack p95 < 300 ms, PIN login
    p95 < 200 ms, slowest query p95 < 50 ms; the report is attached to the PR.
28. `docs/runbooks/local-demo.md` and `infra/README.md` describe starting, migrating, seeding and
    resetting the local database.

## 16. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Engine hydration cost grows with history | Slow first request per user | Working-set snapshot v2 (today + live orders, carried ledger balance); reads of history go to Postgres |
| Single tick-pump/matcher process | Not horizontally scalable yet | Version check makes other writers safe; documented as a Phase 4/5 change (open question 1) |
| Partition maintenance missed | Inserts land in `DEFAULT` | Default partition exists; job creates 14 days ahead; a test alarms when `DEFAULT` has rows |
| PgBouncer transaction mode breaks session features | Hard-to-find bugs in Phase 6 | Rules in §5.4 plus a grep test; optional local PgBouncer run |
| Lost encryption keys | Users' PII unreadable | Dev keys are throwaway; production keys in Secrets Manager (Phase 6); key id per ciphertext for rotation |
| Testcontainers slows CI | Longer PR feedback | One container per test worker, migrate once, truncate between tests; CI uses a service container |
| `bigint` read as `number` overflows | Wrong money | Range check on read; values stay far below 2^53 paise |
| Jobs and the test clock disagree | Flaky E2E | `JOBS_MODE=inline` for clock-driven tests; lazy sync on every read |
| Contract changes (TOTP, consent, new errors) break MSW parity | Dual-backend suites fail | Contracts first, MSW handler in the same epic, scenario suite gate |
| Audit rows kept after purge vs. DPDP erasure | Compliance question | No PII in audit rows; owner confirms retention (open question 2) |

## 17. Dependencies needing owner OK

Per CLAUDE.md §8.6 and implementation-tasks rule 6, any package not named in CLAUDE.md §4 needs the
owner's OK. Versions are pinned exactly (`save-exact`) at the time of the PR.

| Package | Where | Named in CLAUDE.md §4? | Why |
|---|---|---|---|
| `drizzle-orm` | apps/api | **Yes** (Drizzle ORM) | Schema, queries, migrator |
| `drizzle-kit` | apps/api (dev) | **Yes**, part of Drizzle | Generate and check migrations |
| `bullmq` | apps/api | **Yes** (BullMQ jobs) | Job queues on Redis; reuses the existing `ioredis` |
| `testcontainers` | apps/api (dev) | **Yes** (already installed) | Postgres containers via `GenericContainer` |
| `pg` | apps/api | **New** | PostgreSQL driver used by `drizzle-orm/node-postgres` |
| `@types/pg` | apps/api (dev) | **New** | Types for `pg` |
| `qrcode` (optional) | apps/web, lazy-loaded in the security settings chunk | **New** | QR code for TOTP enrolment; without it the UI shows the setup key and `otpauth` link only (open question 3) |

Not needed, by design:

- `@testcontainers/postgresql`: the existing `testcontainers` package covers it.
- `otplib` or similar: TOTP is about 60 lines on Web Crypto in `packages/utils`, tested with the
  RFC 6238 vectors.
- `@fastify/swagger`, `zod-openapi`, `zod-to-json-schema`: Zod 4's `z.toJSONSchema()` is enough.
- Encryption libraries: `node:crypto` (AES-256-GCM, HMAC-SHA256).
- Argon2: already `@node-rs/argon2` (ADR 0004).

Container images (not npm): `postgres:16-alpine` (compose, CI service, Testcontainers) and, for the
optional `pool` profile, `edoburu/pgbouncer` pinned by digest.

## 18. Open questions for the owner

1. **Single writer for paper accounts this phase.** Ticks are generated inside `apps/api`, so one
   `apps/api` process runs the tick pump and matches resting orders; other writers are made safe by
   a version check. Moving matching to a dedicated worker fed by the Phase 4 quote service is
   deferred. OK to accept this simplification (recorded in ADR 0007)?
2. **Deletion retention.** Proposed: soft delete at once, purge after 30 days
   (`ACCOUNT_PURGE_AFTER_DAYS`), audit rows kept after purge with the opaque user id only and no PII.
   OK, or a different grace period or retention?
3. **QR code for TOTP enrolment.** Add `qrcode` (lazy-loaded, web only), or ship with the setup key
   and `otpauth` link only?

## 19. Out of scope

TimescaleDB and candles; AWS, Terraform and managed databases; replicas in use, Citus; load tests at
scale; a real SMS provider; real KYC, PAN or bank data; a matcher worker or quote service; data
export and consent withdrawal short of deletion; a P&L history screen; Swagger UI; audit log hash
chain and write-once archive; email or push notifications.
