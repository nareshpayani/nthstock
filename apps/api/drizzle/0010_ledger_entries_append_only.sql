-- ledger_entries is append-only for the app role (T-200, spec backend-core §4.3 and §8).
-- Hand-written (drizzle-kit generate --custom): Drizzle cannot express grants.
--
-- The baseline's default privileges gave the app and purge roles SELECT, INSERT, UPDATE and DELETE.
-- The app role keeps SELECT and INSERT only, so an UPDATE or DELETE fails with 42501. The purge
-- job also keeps DELETE: it removes a purged user's rows (spec §8) but may not rewrite them.
REVOKE ALL ON TABLE ledger_entries FROM PUBLIC, nthstock_app, nthstock_purge;--> statement-breakpoint
GRANT SELECT, INSERT ON TABLE ledger_entries TO nthstock_app;--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON TABLE ledger_entries TO nthstock_purge;
