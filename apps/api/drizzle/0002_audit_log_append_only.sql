-- audit_log is append-only (T-186, ADR 0007 decision 7, spec backend-core §8), enforced twice.
-- Hand-written (drizzle-kit generate --custom): Drizzle cannot express grants or triggers.
--
-- 1. Grants. The baseline's default privileges gave the app and purge roles SELECT, INSERT,
--    UPDATE and DELETE; on this table they keep only INSERT and SELECT (plus USAGE on the id
--    sequence, from the same defaults). The purge job may insert its own entry but never delete one.
REVOKE ALL ON TABLE audit_log FROM PUBLIC, nthstock_app, nthstock_purge;--> statement-breakpoint
GRANT SELECT, INSERT ON TABLE audit_log TO nthstock_app, nthstock_purge;--> statement-breakpoint
-- 2. A row trigger that rejects UPDATE and DELETE for every role, the owner included. TRUNCATE
--    fires no row trigger and only the owner may run it: tests reset the table that way.
CREATE FUNCTION audit_log_reject_change() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog
AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only: % is not allowed', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION audit_log_reject_change() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER audit_log_append_only
  BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_reject_change();
