-- Display positions of lists and stocks are unique, checked at commit (T-197, spec backend-core
-- §4.2). Hand-written (drizzle-kit generate --custom): Drizzle cannot declare a DEFERRABLE
-- constraint. Deferred, so one transaction can move positions through each other (a reorder)
-- without a temporary clash. The constraints' indexes also serve reads by user and by list.
ALTER TABLE "watchlists"
  ADD CONSTRAINT "watchlists_user_id_position_unique"
  UNIQUE ("user_id", "position") DEFERRABLE INITIALLY DEFERRED;--> statement-breakpoint
ALTER TABLE "watchlist_items"
  ADD CONSTRAINT "watchlist_items_watchlist_id_position_unique"
  UNIQUE ("watchlist_id", "position") DEFERRABLE INITIALLY DEFERRED;
