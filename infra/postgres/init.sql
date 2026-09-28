-- Roles and database privileges for nthstock (ADR 0007, spec backend-core §6 and §8).
--
-- Run as a superuser against the application database:
--   * Docker Compose runs it once, on the first start of an empty volume
--     (/docker-entrypoint-initdb.d, database `nthstock`).
--   * The Postgres test helper (apps/api/src/test/testPostgres.ts) runs it on every test database.
--   * CI runs it with psql against the service container.
-- It is idempotent and names no database: it works on whichever database it is run against.
--
-- The passwords are non-secret local development values (also in apps/api/.env.example). Cloud
-- environments create these roles with generated passwords from Secrets Manager (Phase 6).
--
--   nthstock_owner  owns the database and the schema; runs migrations (DATABASE_MIGRATION_URL).
--   nthstock_app    what apps/api connects as (DATABASE_URL): DML only, never DDL.
--   nthstock_purge  the account purge job: DML like the app role, plus deleting a user's ledger
--                   rows (granted by a later migration); never audit rows.

DO $$
DECLARE
  spec text[];
BEGIN
  FOREACH spec SLICE 1 IN ARRAY ARRAY[
    ARRAY['nthstock_owner', 'nthstock_owner_dev'],
    ARRAY['nthstock_app', 'nthstock_app_dev'],
    ARRAY['nthstock_purge', 'nthstock_purge_dev']
  ] LOOP
    BEGIN
      EXECUTE format('CREATE ROLE %I LOGIN PASSWORD %L', spec[1], spec[2]);
    EXCEPTION
      -- Already there (a second run, or a parallel test worker created it first).
      WHEN duplicate_object OR unique_violation THEN NULL;
    END;
  END LOOP;
END
$$;

DO $$
BEGIN
  -- The owner role owns the database, so it owns the `public` schema (pg_database_owner) and the
  -- `drizzle` schema the migrator creates.
  EXECUTE format('ALTER DATABASE %I OWNER TO nthstock_owner', current_database());
  -- Nobody but the owner connects by default; no temp tables anywhere (PgBouncer rules, §5.4).
  EXECUTE format('REVOKE ALL ON DATABASE %I FROM PUBLIC', current_database());
  EXECUTE format(
    'GRANT CONNECT ON DATABASE %I TO nthstock_app, nthstock_purge',
    current_database()
  );
END
$$;

-- Only the owner creates objects in `public`; the app and purge roles may use what it creates.
-- Table and sequence privileges come from the baseline migration's default privileges.
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO nthstock_app, nthstock_purge;
