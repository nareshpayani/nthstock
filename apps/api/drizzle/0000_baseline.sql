-- Baseline (T-179, ADR 0007): privileges for everything later migrations create.
-- Runs as nthstock_owner (DATABASE_MIGRATION_URL). The roles themselves come from
-- infra/postgres/init.sql.
--
-- DDL stays with the owner: only it may create objects in `public`.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;--> statement-breakpoint
REVOKE CREATE ON SCHEMA public FROM nthstock_app, nthstock_purge;--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO nthstock_app, nthstock_purge;--> statement-breakpoint
-- DML for the app and purge roles on every table and sequence the owner creates from now on.
-- Tables that must be append-only (audit_log, ledger_entries) revoke UPDATE and DELETE in their
-- own migrations.
ALTER DEFAULT PRIVILEGES FOR ROLE nthstock_owner IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO nthstock_app, nthstock_purge;--> statement-breakpoint
ALTER DEFAULT PRIVILEGES FOR ROLE nthstock_owner IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO nthstock_app, nthstock_purge;
